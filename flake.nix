{
  description = "Silent Chat - TUI chat client using imtui";

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

            # Development tools
            ccache
            gdb
            valgrind
          ];

          shellHook = ''
            echo "Silent Chat Development Environment"
            echo "====================================="
            echo "Build commands:"
            echo "  cmake -B build -DCMAKE_BUILD_TYPE=Debug"
            echo "  cmake --build build"
            echo ""
            echo "Run with: ./build/im_silent/im_silent"
          '';
        };

        packages.default = pkgs.stdenv.mkDerivation {
          pname = "im_silent";
          version = "1.0.0";
          src = ./.;

          nativeBuildInputs = with pkgs; [
            cmake
          ];

          buildInputs = with pkgs; [
            ncurses
            openssl
            curl
            sqlite
            nlohmann_json
          ];

          cmakeFlags = [
            "-DCMAKE_BUILD_TYPE=Release"
          ];

          installPhase = ''
            mkdir -p $out/bin
            cp im_silent/im_silent $out/bin/
          '';
        };
      }
    );
}
