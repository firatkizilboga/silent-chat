# im_silent client CMake configuration
cmake_minimum_required(VERSION 3.20)

set(CMAKE_CXX_STANDARD 23)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Find required packages
find_package(OpenSSL REQUIRED)
find_package(CURL REQUIRED)
find_package(SQLite3 REQUIRED)
find_package(nlohmann_json 3.2.0 REQUIRED)

# Build FTXUI library
set(FTXUI_BUILD_EXAMPLES OFF CACHE BOOL "Disable FTXUI examples" FORCE)
set(FTXUI_BUILD_DOCS OFF CACHE BOOL "Disable FTXUI docs" FORCE)
set(FTXUI_ENABLE_INSTALL OFF CACHE BOOL "Disable FTXUI install" FORCE)

# Add FTXUI library
add_subdirectory(external/ftxui)

# im_silent executable
add_executable(im_silent
    src/main.cpp
    src/UI.cpp
    src/crypto.cpp
    src/http.cpp
    src/database.cpp
    src/backend.cpp
    src/app_db.cpp
)

target_include_directories(im_silent PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/src
)

target_link_libraries(im_silent PRIVATE
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
