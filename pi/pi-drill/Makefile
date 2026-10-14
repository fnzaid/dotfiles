# Every command for this package. `make` alone lists them.
.DEFAULT_GOAL := help
.PHONY: help doctor install setup check test smoke fmt bench

help: ## List every command
	@grep -E '^[a-z0-9-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-10s %s\n", $$1, $$2}'

doctor: ## Check Node, npm and Pi, and say how to fix what's missing
	@./scripts/doctor.sh

install: doctor ## Add drill to Pi (this is all you need to use it)
	pi install $(CURDIR)

setup: doctor ## Install the dev tools, for changing drill or running the benchmark
	npm ci --ignore-scripts

check: ## Format check, lint, types, tests with the coverage gate
	npm run check

test: ## Unit and end-to-end tests with coverage
	npm test

smoke: ## Run the real pi command line against a scripted model that tries to write code
	@./scripts/smoke.sh

fmt: ## Format all code
	npm run fmt

bench: ## Measure a model: make bench MODEL=deepseek/deepseek-flash
	@test -n "$(MODEL)" || { echo "Say which model: make bench MODEL=deepseek/deepseek-flash"; exit 2; }
	node bench/run.ts --model $(MODEL) $(ARGS)
