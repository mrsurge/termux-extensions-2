# Agent Ping Protocol

A lightweight protocol for cross-agent communication using PTY transport and the agent log server.

## Overview

This protocol enables one agent (the "controller") to dispatch tasks to another agent (the "worker") running in a terminal, using the agent log as the payload channel. The terminal carries only small control messages while full prompts and responses live in the persistent log.

## Prerequisites

- Agent log server running on `http://127.0.0.1:12359`
- Worker agent (e.g., Gemini CLI) configured with MCP server access to `agent-pty-blocks`
- Controller agent has access to PTY tools and agent log tools

## Protocol Flow

```
┌─────────────┐                              ┌─────────────┐
│ Controller  │                              │   Worker    │
│   Agent     │                              │ (Gemini CLI)│
└──────┬──────┘                              └──────┬──────┘
       │                                            │
       │  1. Post prompt to log (get msg_num)       │
       │─────────────────────────────────────────>  │
       │                                            │
       │  2. Send: "Read #N, respond, DONE:M:STATUS"│
       │─────────────────────────────────────────>  │
       │                                            │
       │  3. Worker reads log #N                    │
       │                                     ┌──────┴──────┐
       │                                     │ Process     │
       │                                     │ prompt      │
       │                                     └──────┬──────┘
       │                                            │
       │  4. Worker posts response to log           │
       │  <─────────────────────────────────────────│
       │                                            │
       │  5. Worker sends: "DONE:M:COMPLETE"        │
       │  <─────────────────────────────────────────│
       │                                            │
       │  6. Controller waits for "DONE:"           │
       │  7. Controller parses M and STATUS         │
       │  8. Controller reads log #M                │
       │                                            │
```

## Implementation

### Step 1: Launch Worker Session

```python
# Start Gemini CLI in screen-reader mode
pty_exec_interactive(
    cmd="gemini --screen-reader",
    conversation_id="gemini-worker-001"
)

# Wait for ready prompt
pty_wait_for(
    conversation_id="gemini-worker-001",
    match="Type your message",
    timeout_ms=60000
)
```

### Step 2: Post Prompt to Log

```python
# Post the full prompt/task to the agent log
result = agent_log_post(
    who="Controller",
    message="""Find all usages of the function `append_record` in server.py.
Trace what calls it and provide:
- File paths and line numbers
- Brief summary of each call site
- The execution flow from entry point to append_record"""
)
prompt_msg_num = result["msg_num"]  # e.g., 430
```

### Step 3: Send Control Message to Worker

```python
# Send minimal control message (no special characters like !)
pty_send(
    conversation_id="gemini-worker-001",
    data=f"Read agent log message {prompt_msg_num} using agent_log_get_by_num tool. "
         f"Execute the task described there. "
         f"Post your complete response to the agent log using agent_log_post. "
         f"Then reply here with only: DONE:<msg_num>:COMPLETE"
)
pty_enter(conversation_id="gemini-worker-001")
```

### Step 4: Wait for Completion

```python
# Wait for the DONE signal
result = pty_wait_for(
    conversation_id="gemini-worker-001",
    match="DONE:",
    timeout_ms=120000  # 2 minutes for standard tasks
)
```

### Step 5: Read Response from Log

```python
# Read the screen to get the msg_num
screen = pty_read_screen(conversation_id="gemini-worker-001")

# Parse DONE:<num> from screen rows
# (look for "DONE:" and extract the number after it)
response_msg_num = parse_done_message(screen["rows"])

# Fetch the full response from log
response = agent_log_get_by_num(msg_num=response_msg_num)
```

## Control Message Format

Keep control messages simple and avoid special characters:

**Good:**
```
Read agent log message 430 using agent_log_get_by_num tool. Post your response to the log. Reply with DONE:<msg_num>:COMPLETE
```

**Avoid:**
- Exclamation marks `!` (triggers shell mode in Gemini)
- Complex punctuation that might be misinterpreted
- Long inline prompts (put those in the log instead)

## Use Cases

### Reconnaissance / Code Search
```
"Find all WebSocket handlers in this codebase. Report file:line and purpose for each."
```

### Execution Tracing
```
"Trace the flow from user input to database write for the /api/messages POST endpoint."
```

### Dependency Mapping
```
"List all imports in server.py and identify which are standard library vs third-party."
```

### Documentation Extraction
```
"Extract all docstrings from mcp_agent_pty_server.py and summarize the MCP tools available."
```

## Long-Running Tasks

For complex tasks expected to take more than 2 minutes, use the following adaptations.

### Controller-Side: Progressive Timeout with Stall Detection

Instead of one long timeout, use an initial generous wait followed by shorter polling intervals with stall detection:

```python
# Initial long wait (5 minutes for complex tasks)
result = pty_wait_for(
    conversation_id="gemini-worker-001",
    match="DONE:",
    timeout_ms=300000  # 5 minutes
)

if not result["matched"]:
    last_screen = None
    for _ in range(10):  # Up to 10 more minutes
        screen = pty_read_screen(conversation_id="gemini-worker-001")
        
        # Stall detection: if two consecutive snapshots are identical, agent is hung
        if last_screen and screen["rows"] == last_screen["rows"]:
            # Stalled - bail out
            break
        
        last_screen = screen
        
        # Short wait for completion
        result = pty_wait_for(
            conversation_id="gemini-worker-001",
            match="DONE:",
            timeout_ms=60000  # 1 minute
        )
        if result["matched"]:
            break
```

### Worker-Side: Self-Imposed Time Limits

For tasks known to be complex, instruct the worker to self-monitor elapsed time:

```
Read agent log message 430. This is a complex task.
Every 6 tool calls, run `date` to check elapsed time.
If you approach 9 minutes, wrap up and post a partial response.
Post your response to the agent log with status COMPLETE or PARTIAL.
Reply with: DONE:<msg_num>:<status>
```

The worker can then:
- Run `date` command periodically between task segments
- Track timestamps internally to monitor progress
- Gracefully exit with a partial response before hitting hard limits

### Response Status Codes

The DONE signal always includes a status (even for simple tasks):

| Signal | Meaning |
|--------|---------|
| `DONE:435:COMPLETE` | Task finished successfully |
| `DONE:435:PARTIAL` | Task hit time limit, partial results in log |
| `DONE:435:ERROR` | Task failed, error details in log |

### When to Use Long-Running Mode

Use this pattern for:
- Deep codebase exploration (tracing execution across many files)
- Large-scale refactoring analysis
- Multi-step workflows with external tool calls
- Tasks explicitly expected to exceed 2 minutes

For simple queries (find function, list files, quick search), use the standard 2-minute timeout.

## Session Management

### Keep Session Alive
The worker session persists across multiple ping cycles. No need to restart between tasks.

### Clean Shutdown
```python
pty_ctrl_c(conversation_id="gemini-worker-001")
```

### Detach for Manual Inspection
The underlying dtach socket can be attached from a real terminal:
```bash
dtach -a ~/.cache/framework_shells/runtimes/<hash>/<hash>/sockets/<socket>.sock
```
Use `Ctrl+\` to detach.

## Error Handling

### Timeout
If `pty_wait_for` times out, read the screen to diagnose:
```python
screen = pty_read_screen(conversation_id="gemini-worker-001")
# Check screen["rows"] for error messages or stuck state
```

### Worker Error
If the worker posts an error to the log, the msg_num will still be returned. Check the log message content for error indicators.

### Session Recovery
If the session gets into a bad state:
```python
pty_ctrl_c(conversation_id="gemini-worker-001")  # Kill current operation
# Then restart with new pty_exec_interactive
```

## Benefits

1. **Minimal terminal chatter** - Full payloads in log, not scrollback
2. **Persistent history** - All prompts and responses numbered and stored
3. **Async-friendly** - Any agent can read the log at any time
4. **No API keys between agents** - Just PTY and HTTP to localhost
5. **Debuggable** - Attach to dtach socket to see what worker sees
