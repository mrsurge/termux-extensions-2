# Gemini Code Assistant Context

This document provides context for the `termux-extensions-2` project, a web framework for Termux that provides a mobile-friendly UI to manage and interact with the Termux environment.

## Project Overview

`termux-extensions-2` is a Flask-based web framework for Termux that provides a mobile-friendly UI to manage and interact with the Termux environment. It operates as a local web server, presenting a clean UI for controlling your terminal sessions. The core functionality is delivered through a system of "extensions" and "apps" that leverage standard command-line tools to provide rich, interactive control over your Termux sessions.

### Key Technologies

*   **Backend:** Python, Flask, Gunicorn
*   **Frontend:** Vanilla JavaScript, HTML, CSS
*   **Real-time:** WebSockets (via `flask-sock`) for the terminal app.

### Architecture

The framework is built on a modular architecture where features are encapsulated in self-contained **extensions** (under `app/extensions/`) or full-page **apps** (under `app/apps/`). The main Flask application discovers, loads, and serves these modules.

A key architectural feature is the **on-demand app backend architecture**. To ensure resource efficiency and process isolation, app backends are launched on-demand in their own framework shells. A generic reverse proxy in the main application forwards requests to the correct worker process.

## Building and Setup

### Initial Setup

The project includes a bootstrap script for Termux devices. On a fresh Termux install, you can get up and running with:

```bash
pkg update
pkg install git
git clone https://github.com/mrsurge/termux-extensions-2.git
cd termux-extensions-2
./scripts/bootstrap_termux.sh
```

This script installs required Termux packages, Python dependencies, and sets up the necessary shell hooks.

## Development Conventions

### Project Structure

*   `app/`: Contains the main Flask application, including extensions, apps, and libraries.
*   `scripts/`: Contains shell scripts for interacting with the Termux environment.
*   `docs/`: Contains project documentation.
*   `GEMINI.md`: This file, providing context for the Gemini Code Assistant.

### Extensions and Apps

Extensions and apps are the primary way to add functionality to the framework. Each module is a directory containing a `manifest.json` file that describes the module and its entry points.

### Frontend Development

The frontend is built with vanilla JavaScript, HTML, and CSS. The project encourages the use of two shared utilities for a consistent user experience:

*   `window.teFilePicker`: A universal file picker modal.
*   `window.teState`: A state-store helper for persisting frontend state.

### Diagnostics and Runtime Management

The framework includes a number of features for diagnostics and runtime management:

*   **Supervisor:** A supervisor process manages the application lifecycle and ensures a clean shutdown.
*   **Runtime Metrics API:** A REST API endpoint at `/api/framework/runtime/metrics` provides detailed runtime information.
*   **Settings App:** A dedicated app for diagnostics, framework shell management, and other settings.

## Agent Operating Instructions
- **Agent Workflow**
  1. **Restate & Confirm Understanding**
  2. **Investigate & Propose Plan**
  3. **Execute Approved Plan**
  4. **Subsequent Interactions**

- **Aesthetics and Styling**: Do not modify styling, layouts, themes, or other project aesthetics without the user's explicit consent. There is no implied consent for visual changes.

**NUMBER ONE RULE:** I MUST **NEVER EVER FOR ANY REASON UNDER ANY CIRCUMSTANCE UNLESS EXPLICITLY INSTRUCTED TO, USE GIT. THIS COMMAND MUST ALWAYS BE EXPLICIT AND NEVER IMPLIED.**

### Core Operating Principles & Interaction Workflow

**1. Safety Protocol: Unsandboxed Execution**

*   **Mandate:** I operate in an unsandboxed environment ("YOLO mode"). All actions that modify the file system or execute commands are performed directly on the user's system.
*   **Express Consent Required:** I will **NEVER** make any changes to the codebase or file system without the user's explicit, expressed consent for a specific, detailed plan. There is no implied consent.

**2. Standard Workflow**

I will follow a structured, multi-step, approval-based workflow for every new task to ensure clarity, accuracy, and user control.

*   **Step 1: Restate & Confirm Understanding**
    *   When a new task is given, my first action is to restate the prompt in a clear, structured format to confirm my understanding. This is the **"Prompt Approval"** stage.
    *   **For Bug Fixes/Issues:** I will summarize the reported issue.
    *   **For New Features/Changes:** I will outline the requested functionality.
    *   **For Instructions from a Markdown File:** I will provide a concise summary of the document's goals and the actions it implies, pending approval.
    *   *I will not proceed until I receive explicit approval for this restatement.*

*   **Step 2: Investigate & Propose a Plan**
    *   Once the restated prompt is approved, I will analyze the codebase and relevant files to determine the best course of action.
    *   My goal is to formulate a detailed, multi-step, actionable plan to address the request.
    *   This is the **"Final Approval"** stage. I will present this plan to the user for their review.
    *   *I will not proceed to execute the plan until I receive explicit approval.*

*   **Step 3: Execute Approved Plan**
    *   After receiving final approval for the detailed plan, I will execute the steps using the available tools.

*   **Step 4: Subsequent Interactions**
    *   After the initial three-step workflow for a task is complete, our interaction for that same task can become more fluid and relaxed.
    *   However, the core principle of **Express Consent** always applies. I will always seek explicit approval before making any further changes.
