# im_silent client CMake configuration
cmake_minimum_required(VERSION 3.20)

set(CMAKE_CXX_STANDARD 23)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Find required packages
find_package(OpenSSL REQUIRED)
find_package(CURL REQUIRED)
find_package(SQLite3 REQUIRED)
find_package(nlohmann_json 3.2.0 REQUIRED)

# Build imtui with ncurses support
set(IMTUI_SUPPORT_NCURSES ON CACHE BOOL "Enable ncurses support" FORCE)
set(IMTUI_SUPPORT_CURL OFF CACHE BOOL "Disable curl support" FORCE)
set(IMTUI_BUILD_EXAMPLES OFF CACHE BOOL "Disable imtui examples" FORCE)

# Add imtui library
add_subdirectory(external/imtui)

# im_silent executable
add_executable(im_silent
    src/main.cpp
    src/crypto.cpp
    src/http.cpp
    src/database.cpp
    src/backend.cpp
    src/app_db.cpp
)

target_include_directories(im_silent PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/external/imtui/include
    ${CMAKE_CURRENT_SOURCE_DIR}/src
)

target_link_libraries(im_silent PRIVATE
    imtui-ncurses
    OpenSSL::SSL
    OpenSSL::Crypto
    CURL::libcurl
    SQLite::SQLite3
    nlohmann_json::nlohmann_json
    pthread
)
