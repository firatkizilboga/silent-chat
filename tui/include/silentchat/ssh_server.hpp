#pragma once

#include <silentchat/config.hpp>
#include <silentchat/logger.hpp>

#include <libssh/libssh.h>
#include <libssh/server.h>
#include <libssh/callbacks.h>

#include <pty.h>
#include <sys/ioctl.h>
#include <sys/wait.h>
#include <termios.h>
#include <unistd.h>
#include <fcntl.h>
#include <signal.h>
#include <cerrno>
#include <cstring>
#include <cstdio>
#include <filesystem>
#include <stdexcept>
#include <string>
#include <cstdint>
#include <thread>

namespace silentchat {

// ── Host key ─────────────────────────────────────────────────────────────────

inline bool ensureHostKey(const std::string& keyPath) {
    namespace fs = std::filesystem;
    if (fs::exists(keyPath)) return true;
    std::error_code ec;
    fs::create_directories(fs::path(keyPath).parent_path(), ec);
    if (ec) return false;
    ssh_key key = nullptr;
    if (ssh_pki_generate(SSH_KEYTYPE_RSA, 4096, &key) != SSH_OK) return false;
    int rc = ssh_pki_export_privkey_file(key, nullptr, nullptr, nullptr, keyPath.c_str());
    ssh_key_free(key);
    return rc == SSH_OK;
}

// ── Per-connection state ──────────────────────────────────────────────────────

struct ConnState {
    int         masterFd       = -1;
    pid_t       childPid       = -1;
    ssh_channel channel        = nullptr;
    struct winsize ws          = {24, 80, 0, 0};
    bool        shellRequested = false;
    std::string fingerprint;

    struct ssh_server_callbacks_struct  sessionCb{};
    struct ssh_channel_callbacks_struct channelCb{};
};

// ── Channel callbacks ─────────────────────────────────────────────────────────

static inline int channelDataCb(ssh_session, ssh_channel,
                                void* data, uint32_t len, int /*is_stderr*/,
                                void* userdata)
{
    auto* st = static_cast<ConnState*>(userdata);
    if (st->masterFd < 0) return static_cast<int>(len);
    ssize_t written = 0;
    while (written < static_cast<ssize_t>(len)) {
        ssize_t n = write(st->masterFd,
                          static_cast<const char*>(data) + written,
                          static_cast<size_t>(len) - static_cast<size_t>(written));
        if (n <= 0) break;
        written += n;
    }
    return static_cast<int>(written);
}

static inline int windowChangeCb(ssh_session, ssh_channel,
                                  int cols, int rows, int /*pxw*/, int /*pxh*/,
                                  void* userdata)
{
    auto* st = static_cast<ConnState*>(userdata);
    if (st->masterFd < 0) return 0;
    struct winsize ws{};
    ws.ws_row = static_cast<unsigned short>(rows);
    ws.ws_col = static_cast<unsigned short>(cols);
    ioctl(st->masterFd, TIOCSWINSZ, &ws);
    kill(st->childPid, SIGWINCH);
    return 0;
}

static inline int ptyRequestCb(ssh_session, ssh_channel,
                                const char* /*term*/,
                                int width, int height, int /*pxw*/, int /*pxh*/,
                                void* userdata)
{
    auto* st = static_cast<ConnState*>(userdata);
    if (width  > 0) st->ws.ws_col = static_cast<unsigned short>(width);
    if (height > 0) st->ws.ws_row = static_cast<unsigned short>(height);
    return 0;
}

static inline int shellRequestCb(ssh_session, ssh_channel, void* userdata)
{
    static_cast<ConnState*>(userdata)->shellRequested = true;
    return 0;
}

// ── Session callbacks ─────────────────────────────────────────────────────────

static inline std::string keyFingerprintHex(struct ssh_key_struct* key) {
    unsigned char* hash = nullptr;
    size_t len = 0;
    if (ssh_get_publickey_hash(key, SSH_PUBLICKEY_HASH_SHA256, &hash, &len) != SSH_OK)
        return "unknown";
    std::string hex;
    hex.reserve(len * 2);
    for (size_t i = 0; i < len; ++i) {
        char buf[3];
        snprintf(buf, sizeof(buf), "%02x", hash[i]);
        hex += buf;
    }
    ssh_clean_pubkey_hash(&hash);
    return hex;
}

static inline int authPubkeyCb(ssh_session, const char*, struct ssh_key_struct* pubkey,
                                char sig_state, void* userdata)
{
    if (sig_state == SSH_PUBLICKEY_STATE_NONE)
        return SSH_AUTH_SUCCESS;
    if (sig_state == SSH_PUBLICKEY_STATE_VALID) {
        static_cast<ConnState*>(userdata)->fingerprint = keyFingerprintHex(pubkey);
        return SSH_AUTH_SUCCESS;
    }
    return SSH_AUTH_DENIED;
}

static inline ssh_channel channelOpenSessionCb(ssh_session session, void* userdata)
{
    auto* st = static_cast<ConnState*>(userdata);
    if (st->channel) return nullptr;

    st->channel = ssh_channel_new(session);

    st->channelCb.userdata                           = st;
    st->channelCb.channel_data_function              = channelDataCb;
    st->channelCb.channel_pty_request_function       = ptyRequestCb;
    st->channelCb.channel_shell_request_function     = shellRequestCb;
    st->channelCb.channel_pty_window_change_function = windowChangeCb;
    ssh_callbacks_init(&st->channelCb);
    ssh_set_channel_callbacks(st->channel, &st->channelCb);

    return st->channel;
}

// ── Single-connection handler ─────────────────────────────────────────────────

static inline void handleClient(ssh_session session, const std::string& tuiBinary)
{
    if (ssh_handle_key_exchange(session) != SSH_OK) {
        LOG_ERROR("SSHServer", "Key exchange failed: " +
                  std::string(ssh_get_error(session)));
        ssh_disconnect(session);
        ssh_free(session);
        return;
    }

    ConnState state;

    state.sessionCb.userdata                              = &state;
    state.sessionCb.auth_pubkey_function                  = authPubkeyCb;
    state.sessionCb.channel_open_request_session_function = channelOpenSessionCb;
    ssh_callbacks_init(&state.sessionCb);
    ssh_set_server_callbacks(session, &state.sessionCb);
    ssh_set_auth_methods(session, SSH_AUTH_METHOD_PUBLICKEY);

    ssh_event ev = ssh_event_new();
    ssh_event_add_session(ev, session);

    while (!state.shellRequested) {
        if (ssh_event_dopoll(ev, 1000) == SSH_ERROR) {
            LOG_WARN("SSHServer", "Poll error during negotiation");
            ssh_event_free(ev);
            ssh_disconnect(session);
            ssh_free(session);
            return;
        }
    }

    int   masterFd = -1;
    pid_t childPid = forkpty(&masterFd, nullptr, nullptr, &state.ws);

    if (childPid < 0) {
        LOG_ERROR("SSHServer", "forkpty: " + std::string(strerror(errno)));
        ssh_event_free(ev);
        if (state.channel) { ssh_channel_close(state.channel); ssh_channel_free(state.channel); }
        ssh_disconnect(session);
        ssh_free(session);
        return;
    }

    if (childPid == 0) {
        std::string userXdg = (getServerStateDir() / "users" / state.fingerprint).string();
        setenv("XDG_STATE_HOME", userXdg.c_str(), 1);
        const char* args[] = {tuiBinary.c_str(), nullptr};
        execv(tuiBinary.c_str(), const_cast<char* const*>(args));
        _exit(1);
    }

    state.masterFd = masterFd;
    state.childPid = childPid;
    fcntl(masterFd, F_SETFL, O_NONBLOCK);

    bool running = true;
    char buf[4096];

    while (running) {
        if (ssh_event_dopoll(ev, 10) == SSH_ERROR) break;

        for (;;) {
            ssize_t n = read(masterFd, buf, sizeof(buf));
            if (n > 0) {
                ssh_channel_write(state.channel, buf, static_cast<uint32_t>(n));
            } else if (n < 0 && (errno == EAGAIN || errno == EWOULDBLOCK)) {
                break;
            } else {
                running = false;
                break;
            }
        }

        if (ssh_channel_is_eof(state.channel) || ssh_channel_is_closed(state.channel))
            running = false;
    }

    ssh_event_free(ev);
    ssh_channel_send_eof(state.channel);
    ssh_channel_close(state.channel);
    ssh_channel_free(state.channel);
    ssh_disconnect(session);
    ssh_free(session);

    kill(childPid, SIGTERM);
    waitpid(childPid, nullptr, 0);
    close(masterFd);
}

// ── Server accept loop ────────────────────────────────────────────────────────

inline void runSSHServer(uint16_t port,
                         const std::string& keyPath,
                         const std::string& tuiBinary)
{
    signal(SIGPIPE, SIG_IGN);

    ssh_bind bind = ssh_bind_new();
    ssh_bind_options_set(bind, SSH_BIND_OPTIONS_BINDPORT, &port);
    ssh_bind_options_set(bind, SSH_BIND_OPTIONS_RSAKEY,   keyPath.c_str());

    if (ssh_bind_listen(bind) < 0) {
        std::string err = ssh_get_error(bind);
        ssh_bind_free(bind);
        throw std::runtime_error("ssh_bind_listen: " + err);
    }

    LOG_INFO("SSHServer", "Listening on port " + std::to_string(port));

    while (true) {
        ssh_session session = ssh_new();
        if (ssh_bind_accept(bind, session) != SSH_OK) {
            LOG_ERROR("SSHServer", "ssh_bind_accept: " +
                      std::string(ssh_get_error(bind)));
            ssh_free(session);
            continue;
        }
        std::thread([session, tuiBinary]() {
            handleClient(session, tuiBinary);
        }).detach();
    }

    ssh_bind_free(bind);
}

} // namespace silentchat
