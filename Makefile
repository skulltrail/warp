# warp — developer Makefile
#
# Quick start:
#   make setup     # install deps + git hooks
#   make build     # produce the release zip + unpacked bundle in dist/
#   make ci        # lint + test + build

# --- Config ----------------------------------------------------------------

SHELL := /bin/bash
VERSION := $(shell node -p "require('./manifest.json').version")

# --- Meta ------------------------------------------------------------------

.DEFAULT_GOAL := help

.PHONY: help
help: ## Show this help
	@echo "warp v$(VERSION) — available targets:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| sort \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-10s\033[0m %s\n", $$1, $$2}'

# --- Environment -----------------------------------------------------------

.PHONY: setup
setup: ## Install dependencies and configure git hooks
	npm install

.PHONY: lint
lint: ## Run ESLint
	npm run lint

.PHONY: test
test: ## Run the test suite
	npm test

.PHONY: ci
ci: ## Run lint + test + build (same as CI)
	npm run ci

# --- Build -----------------------------------------------------------------

.PHONY: build
build: ## Build the release zip + unpacked bundle into dist/
	npm run build
	@echo ""
	@echo "Load in Firefox: about:debugging#/runtime/this-firefox ->"
	@echo "  Load Temporary Add-on -> select dist/unpacked/manifest.json"

.PHONY: sign
sign: build ## Sign a permanent Firefox .xpi via AMO (needs AMO_JWT_ISSUER/SECRET)
	@if [ -z "$$AMO_JWT_ISSUER" ] || [ -z "$$AMO_JWT_SECRET" ]; then \
		echo "Set AMO_JWT_ISSUER and AMO_JWT_SECRET (addons.mozilla.org -> Manage API Keys)."; \
		exit 1; \
	fi
	npx --yes web-ext sign \
		--source-dir dist/unpacked \
		--artifacts-dir dist \
		--channel unlisted \
		--api-key "$$AMO_JWT_ISSUER" \
		--api-secret "$$AMO_JWT_SECRET"
	@echo "Signed .xpi written to dist/ — install via about:addons -> Install Add-on From File."

.PHONY: clean
clean: ## Remove build artifacts
	rm -rf dist
