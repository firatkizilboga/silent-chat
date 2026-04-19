# schatui

A TUI chat client built with FTXUI.

## Build & Run

```sh
nix develop          # enter the dev shell (required for cmake builds)
cmake -B build -DCMAKE_BUILD_TYPE=Debug && cmake --build build
./build/tui          # run directly

nix build            # build a release package (creates ./result)
./result/bin/schatui # run the release binary

nix profile add ./result  # install schatui globally

nix profile remove schatui # remove schatui globally
```
