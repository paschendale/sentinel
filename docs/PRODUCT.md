# Sentinel — Product Overview

## What is Sentinel?

Sentinel is a **programmable reliability engine** — a lightweight synthetic testing and uptime monitoring platform built for developers who need more than "is it up?".

Where existing tools like Uptime Kuma give you YAML pings and Gatus gives you sequential checks, Sentinel gives you **real JavaScript test functions** that run in parallel, validate business logic, and report results with precision.

## The Problem

Current open-source uptime monitors fall into two traps:

- **Too bloated**: Uptime Kuma is a dashboard-first tool that grows heavy with features and struggles to scale concurrent checks efficiently.
- **Too limited**: Gatus is config-driven YAML with no programmability and sequential-only execution — it can't validate whether an API response is semantically correct, only whether it returned 200.

Neither tool is built for developers who want to write actual test logic.

## What Sentinel Does

- Runs **JavaScript test functions** on a schedule — you write the assertion logic, not YAML
- Executes **up to 500 tests/minute** concurrently with strict resource limits
- Stores **30 days of uptime history** (7-day raw, 30-day aggregated)
- Delivers **state-change alerts** to Discord, Slack, or any webhook
- Keeps credentials out of test code via an **encrypted secret store** (`ctx.secrets.NAME`), write-only after creation
- Exposes a **Prometheus metrics endpoint** for existing observability stacks
- Serves **public read-only status pages** built from aggregated data

## Who It's For

**Primary users:**
- Backend and DevOps engineers running production services
- Teams operating microservices that need synthetic integration testing
- Organizations that want uptime monitoring without adopting another SaaS tool

**Profile:**
- Comfortable writing JavaScript/TypeScript
- Wants to run monitors on a small VPS (1GB RAM / 0.5 vCPU)
- Values correctness and observability over UI polish

## Core Value Propositions

1. **Tests as code** — write a JS function that returns `true` or `false`, not YAML assertions
2. **High concurrency** — 5–10 parallel test slots, ~500 tests/min sustainable throughput
3. **Lightweight deployment** — single process, Postgres, runs on the smallest cloud VM
4. **Meaningful alerts** — state-change only, failure threshold before paging, cooldown between duplicates
5. **Public dashboards** — shareable status pages built from pre-aggregated data

## Non-Goals

- **Not a no-code tool** — there is no drag-and-drop test builder
- **Not an APM replacement** — Sentinel does not trace requests or collect application metrics
- **Not beginner-friendly by design** — the target user writes code
- **Not a multi-tenant SaaS** — designed for single-team self-hosted deployment (multi-user auth is a future concern)
- **Not a full observability platform** — use Prometheus + Grafana for dashboards; Sentinel feeds them
