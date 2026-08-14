# warp — developer Makefile
#
# Quick start:
#   make setup     # install deps + git hooks
#   make build     # produce the release zip + unpacked bundle in dist/
#   make dev-chromium  # launch a disposable Chromium profile
#   make dev-firefox   # launch a disposable Firefox profile
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
	npm ci

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
build: ## Build clean archives + locally configured unpacked bundles
	npm run build
	@echo ""
	@echo "Chromium: dist/chromium/"
	@echo "Firefox:  dist/firefox/"

.PHONY: dev-chromium
dev-chromium: ## Build and launch Chromium with local config
	npm run dev:chromium

.PHONY: dev-firefox
dev-firefox: ## Build and launch Firefox with local config
	npm run dev:firefox

.PHONY: sign
sign: ## Sign a permanent Firefox .xpi via AMO (needs AMO_JWT_ISSUER/SECRET)
	@if [ -z "$$AMO_JWT_ISSUER" ] || [ -z "$$AMO_JWT_SECRET" ]; then \
		echo "Set AMO_JWT_ISSUER and AMO_JWT_SECRET (addons.mozilla.org -> Manage API Keys)."; \
		exit 1; \
	fi
	npm run build:release
	npx --yes web-ext@10.6.0 sign \
		--source-dir dist/firefox \
		--artifacts-dir dist \
		--channel unlisted \
		--api-key "$$AMO_JWT_ISSUER" \
		--api-secret "$$AMO_JWT_SECRET"
	@echo "Signed .xpi written to dist/ — install via about:addons -> Install Add-on From File."

.PHONY: clean
clean: ## Remove build artifacts
	rm -rf dist
