{
  description = "Silent Chat - TUI chat client using FTXUI";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
      in
      {
        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            # Build tools
            cmake
            gnumake
            gcc
            clang

            # Required libraries
            ncurses
            openssl
            curl
            sqlite
            nlohmann_json
            ftxui
            libssh
            zlib

            # Development tools
            ccache
            gdb
            valgrind
          ];

          shellHook = ''
            export LD_LIBRARY_PATH="${pkgs.lib.makeLibraryPath (with pkgs; [
              zlib libssh openssl curl sqlite ftxui ncurses
            ])}:/lib64:/usr/lib64:$LD_LIBRARY_PATH"
            echo "Silent Chat Development Environment"
            echo "====================================="
            echo "Build commands:"
            echo "  cmake -B build -DCMAKE_BUILD_TYPE=Debug"
            echo "  cmake --build build"
            echo ""
            echo "Run with: ./build/schatui"
          '';
        };

        packages.default = pkgs.stdenv.mkDerivation {
          pname = "schatui";
          version = "1.0.0";
          src = ./.;

          nativeBuildInputs = with pkgs; [
            cmake
          ];

          buildInputs = with pkgs; [
            openssl
            curl
            sqlite
            nlohmann_json
            ftxui
            libssh
            zlib
          ];

          cmakeFlags = [
            "-DCMAKE_BUILD_TYPE=Release"
          ];

          installPhase = ''
            mkdir -p $out/bin
            cp schatui $out/bin/schatui
            cp schatui-ssh-server $out/bin/schatui-ssh-server
          '';
        };
      }
    );
}