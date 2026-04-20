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

# tui executable
add_executable(tui
    src/main.cpp
    src/UI.cpp
    src/crypto.cpp
    src/http.cpp
    src/database.cpp
    src/backend.cpp
    src/app_db.cpp
)

target_include_directories(tui PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/src
)

target_link_libraries(tui PRIVATE
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
target_compile_options(tui PRIVATE
    -Wall
    -Wextra
    -Wpedantic
    -Wshadow
    -Wconversion
)

# Add sanitizers for debug builds
if(CMAKE_BUILD_TYPE MATCHES Debug)
    target_compile_options(tui PRIVATE
        -fsanitize=address
        -fsanitize=undefined
        -fno-omit-frame-pointer
    )
    target_link_options(tui PRIVATE
        -fsanitize=address
        -fsanitize=undefined
    )
endif()
