#pragma once

#include <string>
#include <cstdint>

namespace silentchat {

// Generate and save an RSA host key to keyPath if one does not exist.
bool ensureHostKey(const std::string& keyPath);

// Start the SSH server. Blocks forever.
// port      – TCP port to listen on (e.g. 2222)
// keyPath   – path to the RSA host key file
// tuiBinary – absolute path to the tui executable to exec per connection
void runSSHServer(uint16_t port,
                  const std::string& keyPath,
                  const std::string& tuiBinary);

} // namespace silentchat
