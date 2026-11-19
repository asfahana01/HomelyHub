# GitHub Actions workflows

This directory defines CI checks for the repository. The workflow runs on
pushes and pull requests using Node.js 20. It installs the backend and
frontend dependencies from their lockfiles, checks the environment example and
backend JavaScript syntax, runs backend tests and the configured coverage
threshold, lints selected frontend utilities, and builds the frontend.

## Files

| File | Responsibility |
| --- | --- |
| [ci.yml](./ci.yml) | Runs the repository validation job on GitHub Actions. |

## Navigation

- Parent: [GitHub configuration](../README.md)
- Root: [HomelyHub](../../README.md)
