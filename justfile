set shell := ["bash", "-cu"]

# Default: list available commands
default:
    @just --list

# Run the Node test suite. Auto-installs deps if node_modules is missing.
test:
    @[ -d node_modules ] || npm ci --silent
    npm test
