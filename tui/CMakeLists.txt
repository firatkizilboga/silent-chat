cmake_minimum_required(VERSION 3.20)
project(silent-chat VERSION 1.0.0)

set(CMAKE_CXX_STANDARD 23)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Find required packages
find_package(OpenSSL REQUIRED)
find_package(CURL REQUIRED)
find_package(SQLite3 REQUIRED)
find_package(nlohmann_json 3.2.0 REQUIRED)

find_package(ftxui REQUIRED)
find_package(libssh REQUIRED)

# schatui executable
add_executable(schatui
    src/main.cpp
    src/UI.cpp
    src/crypto.cpp
    src/http.cpp
    src/database.cpp
    src/backend.cpp
    src/app_db.cpp
)

target_include_directories(schatui PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/src
)

target_link_libraries(schatui PRIVATE
    ftxui::screen
    ftxui::dom
    ftxui::component
    OpenSSL::SSL
    OpenSSL::Crypto
    CURL::libcurl
    SQLite::SQLite3
    nlohmann_json::nlohmann_json
    pthread
)

# Compiler warning flags
target_compile_options(schatui PRIVATE
    -Wall
    -Wextra
    -Wpedantic
    -Wshadow
    -Wconversion
)

# schatui-ssh-server executable (SSH server)
add_executable(schatui-ssh-server
    src/main-server.cpp
    src/ssh_server.cpp
)

target_include_directories(schatui-ssh-server PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/src
)

target_link_libraries(schatui-ssh-server PRIVATE
    OpenSSL::SSL
    OpenSSL::Crypto
    CURL::libcurl
    SQLite::SQLite3
    nlohmann_json::nlohmann_json
    pthread
    ssh
    util
)

target_compile_options(schatui-ssh-server PRIVATE
    -Wall
    -Wextra
    -Wpedantic
    -Wshadow
    -Wconversion
)

# Add sanitizers for debug builds
if(CMAKE_BUILD_TYPE MATCHES Debug)
    target_compile_options(schatui PRIVATE
        -fsanitize=address
        -fsanitize=undefined
        -fno-omit-frame-pointer
    )
    target_link_options(schatui PRIVATE
        -fsanitize=address
        -fsanitize=undefined
    )
endif()
