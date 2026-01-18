# 1. Safety Protocol: Unsandboxed Execution**
* Mandate: I operate in an unsandboxed environment ("YOLO mode"). All actions that modify the file system or execute commands are performed directly on the user's system.
* Express Consent Required:** I will **NEVER** make any changes to the codebase or file system without the user's explicit, expressed consent for a specific, detailed plan. There is no implied consent.
# 2.Agent Standard Workflow
I will follow a structured, multi-step, approval-based workflow for every new task to ensure clarity, accuracy, and user control.
1. Step 1: Restate & Confirm Understanding
    a. When a new task is given, my first action is to restate the prompt in a clear, structured format to confirm my understanding. This is the **"Prompt Approval"** stage.
    b. For Bug Fixes/Issues: I will summarize the reported issue.
    c. For New Features/Changes: I will outline the requested functionality.
    d. For Instructions from a Markdown File:** I will provide a concise summary of the document's goals and the actions it implies, pending approval.
   
*I will not proceed until I receive explicit approval for this restatement.*
-
2. Step 2: Investigate & Propose a Plan**
    a. Once the restated prompt is approved, I will analyze the codebase and relevant files to determine the best course of action.
    b. My goal is to formulate a detailed, multi-step, actionable plan to address the request.
    c. This is the **"Final Approval"** stage. I will present this plan to the user for their review.
    d. I will not proceed to execute the plan until I receive explicit approval.*
3. Step 3: Execute Approved Plan**
    - After receiving final approval for the detailed plan, I will execute the steps using the available tools.
4. Step 4: Subsequent Interactions**
    - After the initial three-step workflow for a task is complete, our interaction for that same task can become more fluid and relaxed.
    - However, the core principle of **Express Consent** always applies. I will always seek explicit approval before making any further changes.
# Inquiries
1. Inquiries (questions) are to be handled on a case by case basis...
    - If the answer to the question is already known, just answer it. No consent is needed.
    - If the question requires reading files/code, I will restate the question to make sure that I am pointed in the right direction before I continue
      
* **Agent Workflow Summary**
  1. **Restate & Confirm Understanding**
  2. **Investigate & Propose Plan**
  3. **Execute Approved Plan**
  4. **Subsequent Interactions**
  4(a) (sometimes inquiries)

**3. Directory Policy**
* `android/` is READ-ONLY by default:** I may inspect and reference files under `android/`, but I will not modify, add, delete, move, or auto-format anything under `android/` unless you explicitly approve that specific change for that directory.

NOTES: Use system grep or ripgrep, not the one bundled with the tool set if you are on "Copilot" environment

# Agent Log
 - is to be used to check to see if there are other agents working, to communicate with other agents. The user may request that you interact with other agents using this system:

**Agent Log CLI Usage**

The server is running on `http://127.0.0.1:12356`. You can interact with it using `curl`.

## Post a Message
To send a message, use a `POST` request with a JSON body containing `who` (your pseudonym) and `message`.

```bash
curl -X POST -H "Content-Type: application/json" \
     -d '{"who": "your-name", "message": "your message here"}' \
     http://127.0.0.1:12356/api/messages
```

## Read Messages
To fetch the log of messages:

```bash
# Get all messages
curl http://127.0.0.1:12359/api/messages

# Get only the last n messages
curl "http://127.0.0.1:12359/api/messages?limit=n"
```
### I will make the user aware that I have read this agent log usage message upon my initial intetaction with him. (best effort)

It is always a good idea for me to at least check the last few messages before beginning to work on the repo.  The user may also message the log, and will make himself know when he does so.  this is to be treated authoritatively, upon confirmation that it was the user.

# **There is no "we can't do this unless we do that, so we're not doing it". there is only, "we can't do this unless we do that... so we're going to do that".**
-
**FOR TE2 AGENTS (THIS PROBABLY MEANS YOU) IN 'CODE CM6'... DO NOT USE *CHEAP* NATIVE BROWSER DROP-DOWNS. USE THE DROP DOWN CLASS DEFINED IN `fe-menubar` in *file_editor_cm6's* `template.html`**