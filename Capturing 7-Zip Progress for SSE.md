

# **Capturing and Streaming 7-Zip Progress via a Server-Sent Events Endpoint**

## **Executive Summary: An Architecture for Real-Time Process Monitoring**

The challenge of providing real-time feedback for long-running backend tasks is a common scenario in modern software engineering. This report addresses the specific problem of capturing progress from the 7-Zip command-line utility and streaming it to a web client, framing it as a model for bridging legacy, terminal-oriented tools with contemporary, event-driven web interfaces. The value of this integration lies in delivering an enhanced user experience, where users receive immediate, continuous feedback on operations like large-scale file compression or extraction, transforming a passive waiting period into an interactive and transparent process.

To achieve this, a robust, three-tier architecture is proposed. This architecture is designed to decouple the components, ensuring maintainability and scalability. The three tiers are:

1. **The Data Source:** The 7-Zip command-line process, specifically configured using its output control switches to emit machine-readable progress information as a continuous stream.  
2. **The Orchestration Layer:** A Python backend service that acts as the system's core. It is responsible for spawning and managing the 7-Zip subprocess, and critically, for reading its output stream in a non-blocking manner to prevent the service from becoming unresponsive.  
3. **The Presentation Layer:** A Server-Sent Events (SSE) endpoint exposed by the Python backend. This endpoint serves as a standardized, efficient mechanism for streaming the captured progress data to any number of connected web clients in real-time.

The design of this solution is guided by key architectural principles. It prioritizes robustness, ensuring that process errors and network disconnects are handled gracefully. It achieves cross-platform compatibility, with a core I/O pattern that functions identically on both POSIX-compliant systems (like Linux and macOS) and Windows. Finally, it establishes a decoupled structure that allows each component to be developed, tested, and scaled independently. The foundation of this architecture rests on two powerful patterns: the Thread-Queue-Reader pattern for managing asynchronous I/O with the subprocess, and the Server-Sent Events protocol for lightweight, unidirectional, real-time communication with the client.

---

## **Chapter 1: Taming the 7-Zip Output Stream**

A deep analysis of the 7-Zip command-line interface is the necessary foundation for this architecture. Reliably extracting progress data requires a nuanced understanding of its output mechanisms, which are optimized for performance and interactive terminal use rather than programmatic parsing.

### **1.1 The Challenge of CLI Progress Reporting**

A common source of frustration for developers is the observation that the standard 7z.exe or 7z executable does not display percentage-based progress when its output is redirected to a file or another process.1 This behavior is not an oversight but a deliberate design choice. The 7-Zip development team has historically prioritized raw performance, and the overhead associated with calculating, formatting, and printing progress updates for every file can be non-trivial, particularly during high-speed operations on thousands of small files.1 Consequently, progress reporting is an explicit, opt-in feature rather than a default behavior.

Furthermore, when progress is enabled in an interactive terminal, 7-Zip employs a technique common to many command-line utilities: the use of control characters to create an illusion of an in-place, updating display. Specifically, it uses a carriage return character (\\r) to move the cursor to the beginning of the current line without advancing to a new line. Subsequent progress updates then overwrite the previous ones.2 This is highly effective for human visual consumption but poses a significant challenge for programmatic capture. Standard line-reading functions (such as Python's

readline()) typically buffer input until a newline character (\\n) is received. Since 7-Zip's progress lines end with \\r and not \\n, a naive readline() call will block indefinitely, waiting for a newline that never arrives. This fundamental mismatch between terminal-centric output and stream-based parsing dictates the entire strategy for capturing data in the Python orchestration layer.

### **1.2 Deconstructing the \-bs Switch**

The official mechanism for controlling 7-Zip's output streams is the \-bs switch, which provides granular control over where output, error, and progress information are directed.3 While powerful, its syntax is terse and requires careful deconstruction.

The full syntax is \-bs{o|e|p}{0|1|2}.

* The first parameter, {o|e|p}, selects the stream to configure:  
  * o: Standard **o**utput, which includes file lists during operations like list or add.  
  * e: Standard **e**rror messages.  
  * p: **P**rogress information.  
* The second parameter, {0|1|2}, specifies the destination for the selected stream:  
  * 0: Disables the stream entirely.  
  * 1: Redirects the stream to stdout (standard output).  
  * 2: Redirects the stream to stderr (standard error).

By combining these parameters, a developer can precisely isolate the progress information. For instance, the command 7z a archive.7z \* \-bsp2 redirects the **p**rogress stream to stderr.3 This is often the most desirable configuration, as it separates the progress updates from the primary

stdout stream, which might be used for other purposes (e.g., streaming the compressed archive data itself). Conversely, 7z a archive.7z \* \-bsp1 sends progress to stdout, where it may be interleaved with other output.2 This distinction is critical, as it informs the Python implementation which process pipe (

process.stdout or process.stderr) must be monitored.

### **1.3 Reverse-Engineering the Progress Stream Format**

With progress reporting enabled via the \-bs switch, the output stream contains lines formatted for terminal overwriting. A typical progress line during an archive operation might look like this: \\r 16% 279 U folder/file.txt.5

This line can be broken down into several components:

* **Carriage Return (\\r):** The leading control character that resets the cursor position. Any parsing logic must account for and strip this character.  
* **Percentage:** The primary metric of interest, formatted as a number followed by a percent sign (e.g., 16%).  
* **File/Byte Counts:** Additional metrics, such as the number of files processed (279 in the example).  
* **Status and Filename:** Information about the current operation (e.g., U for Updating) and the file being processed.

The structure of this line necessitates a robust parsing strategy, such as a regular expression, to reliably extract the numerical percentage value. A simple string split might be brittle if the number of components on the line changes. The presence of the leading \\r and the absence of a trailing \\n are the most important characteristics of this stream, directly influencing the design of the non-blocking reader in the subsequent chapter. The challenge posed by 7-Zip's output is not unique; it is representative of a broad class of legacy command-line tools. The techniques required to tame its output—stream redirection, control character handling, and stateful parsing—form a reusable blueprint for modernizing and integrating any such utility into an automated, event-driven system.

### **Table 1: Definitive Guide to the 7-Zip \-bs Switch**

To eliminate ambiguity and provide an actionable reference, the following table details the behavior of the most critical combinations of the \-bs switch.

| Switch Combination | Progress Stream (p) | Error Stream (e) | Standard Output (o) | Primary Use Case and Analysis |
| :---- | :---- | :---- | :---- | :---- |
| \-bsp1 | stdout | stderr (default) | stdout (default) | Redirects progress to stdout. This is functional but mixes progress data with other standard output like file lists, requiring more complex parsing. |
| \-bsp2 | stderr | stderr (default) | stdout (default) | Redirects progress to stderr. This is a strong choice for isolating progress information from the main data output stream. |
| \-bse0 | stderr (default) | Disabled | stdout (default) | Suppresses all error messages. Useful in scenarios where only success or progress information is desired. |
| \-bso0 | stderr (default) | stderr (default) | Disabled | Suppresses standard output, such as file listings during an add operation. This helps to create a cleaner stream for parsing. |
| \-bsp2 \-bso0 | stderr | stderr | Disabled | **Recommended Configuration.** This combination provides the cleanest possible signal. It isolates both progress and errors onto the stderr stream while completely silencing the stdout stream, making it ideal for unambiguous programmatic capture. |

---

## **Chapter 2: The Non-Blocking Subprocess Pattern in Python**

The central implementation challenge lies within the Python backend: how to execute the 7-Zip subprocess and continuously read its output without halting the main application thread. In the context of a web server, which must remain responsive to multiple concurrent requests, blocking I/O operations are impermissible.

### **2.1 The Peril of Blocking I/O in a Server Context**

A naive approach to reading from a subprocess involves a simple blocking call within a loop. For example:

Python

\# WARNING: This is a blocking implementation and should NOT be used in a web server.  
import subprocess  
process \= subprocess.Popen(\['7z', 'a', 'archive.7z', '\*', '-bsp2'\], stderr=subprocess.PIPE, text=True)  
for line in process.stderr:  
    print(line)

When this code is executed within a web request handler, the server's worker thread or process will enter a blocked state at the for line in process.stderr: statement. It will wait indefinitely for the 7-Zip process to complete and close its stderr pipe before it can proceed.6 During this time, which could be minutes or hours for a large archive, that worker is completely monopolized and cannot handle any other incoming HTTP requests, effectively causing a denial of service.7 The root cause is that I/O on operating system pipes is, by default, a synchronous, blocking system call that pauses thread execution until data becomes available.

### **2.2 Evaluating Non-Blocking I/O Strategies**

Several strategies exist in Python to perform non-blocking I/O, but their portability varies significantly.

On POSIX-compliant systems (like Linux and macOS), modules and functions are available to handle this elegantly. The select module can be used to poll a file descriptor to see if it's ready for reading without blocking.6 Alternatively, one can use

os.set\_blocking(process.stderr.fileno(), False) to switch the underlying file descriptor into non-blocking mode, causing read calls to return immediately (either with data or an error indicating no data is available).6

However, these solutions share a critical flaw: they are not cross-platform. Specifically, the select function on Windows cannot be used on file-like objects that are not sockets, which includes subprocess pipes.6 This limitation makes these approaches unsuitable for a robust, general-purpose architecture that must operate in diverse deployment environments. The requirement for Windows compatibility is not merely a preference; it is a hard constraint that invalidates the simpler POSIX-only techniques and forces the adoption of a more universally applicable pattern.

This leads to the definitive, cross-platform solution: **the Thread-Queue-Reader pattern**. This pattern elegantly solves the blocking I/O problem by offloading the work to a separate thread.10 It consists of three components:

1. A dedicated worker **Thread** is launched. Its sole responsibility is to execute the blocking read call on the subprocess's output pipe.  
2. A thread-safe **Queue** (from Python's queue module) is instantiated. It serves as the communication bridge between the worker thread and the main application thread.  
3. The main application thread, such as a web server's request handler, can then perform a non-blocking **Read** operation on the queue (e.g., queue.get\_nowait()). If data is available, it is retrieved instantly; if not, an exception is raised immediately, and the main thread can continue its work without ever blocking.

This pattern is the most reliable and portable method for achieving non-blocking reads from a subprocess, as it relies only on Python's standard threading and queue libraries, which are consistent across all major operating systems.

### **2.3 Implementing a Reusable SubprocessReader Class**

To promote clean, modular code, the Thread-Queue-Reader pattern should be encapsulated within a reusable class. This SubprocessReader class hides the complexities of threading, process management, and inter-thread communication behind a simple and intuitive API.

A well-designed SubprocessReader class would include:

* An \_\_init\_\_(self, command\_args) method that accepts the command and arguments to be executed.  
* A start(self) method that uses subprocess.Popen to launch the external process, configured to pipe the appropriate stream (e.g., stderr=subprocess.PIPE).12 This method also creates and starts the daemonized reader thread. Setting the thread as a daemon (  
  t.daemon \= True) is crucial, as it ensures the reader thread will not prevent the main application from exiting.10  
* An internal worker function (e.g., \_enqueue\_output) that runs in the thread, continuously reads from the subprocess pipe using a blocking call like iter(out.readline, b''), and places the output into the queue.  
* A readline\_nowait(self) method that provides the public, non-blocking interface. It wraps a try...except queue.Empty block around a call to q.get\_nowait(), returning a line of output or None.  
* A status-checking method like is\_running(self) that uses process.poll() to determine if the subprocess is still active.

This encapsulation is a powerful architectural principle. It allows the higher-level application logic, such as the web endpoint, to interact with the long-running process through a simple, non-blocking API, remaining completely unaware of the intricate I/O handling occurring under the hood.

---

## **Chapter 3: Engineering a Resilient Server-Sent Events Endpoint**

The presentation layer of the architecture is responsible for transmitting the captured progress data to the client. Server-Sent Events (SSE) provides a standardized, efficient, and resilient protocol for this purpose, perfectly suited to the unidirectional data flow required for progress updates.

### **3.1 A Primer on Server-Sent Events (SSE)**

Server-Sent Events is a web standard that enables a server to push data to a client over a single, long-lived HTTP connection.13 It offers distinct advantages over other real-time communication technologies for this specific use case.

* **Versus WebSockets:** While WebSockets provide powerful, bi-directional communication, they are more complex, requiring a protocol upgrade handshake and often a separate server implementation. SSE operates over standard HTTP, making it simpler to implement and more friendly to existing infrastructure like firewalls. For the strictly unidirectional server-to-client push of progress data, the bi-directional capability of WebSockets is unnecessary overhead.14  
* **Versus Polling:** Compared to traditional short-polling or long-polling techniques, SSE is vastly more efficient. It eliminates the latency and HTTP overhead associated with the client repeatedly making new requests to check for updates.16

The SSE protocol itself is remarkably simple. The server responds to the client's initial request with a Content-Type header of text/event-stream and keeps the connection open. Subsequent messages are sent as plain text, formatted according to a simple specification.18 A complete message, or event, is composed of one or more fields and is terminated by a double newline (

\\n\\n). Key fields include:

* data: \<message\>: This field contains the actual payload of the event. If a message spans multiple lines, multiple data: fields can be sent consecutively; the client will concatenate them.16  
* event: \<event\_name\>: An optional field that assigns a name to the event. This allows the client to register specific event listeners for different types of messages (e.g., 'progress', 'error', 'complete').18  
* id: \<unique\_id\>: An optional field that assigns a unique ID to the event. If the client disconnects, it will automatically send the ID of the last event it received in a Last-Event-ID header upon reconnection. This allows the server to resume the stream from where the client left off.16  
* retry: \<milliseconds\>: An optional field that instructs the client on how long to wait before attempting to reconnect after a connection loss.16

### **3.2 Implementation with FastAPI/Flask**

Modern Python web frameworks provide elegant ways to implement SSE endpoints. Both FastAPI and Flask support a streaming response pattern that is ideal for this task. The core of the implementation is a route handler that returns a special response object wrapping a generator function.15

This generator function is the heart of the SSE endpoint. It runs in a loop, continuously performing non-blocking reads from the SubprocessReader's queue. When new data is available, it is parsed, formatted into a valid SSE message string, and then yielded. The web server streams each yielded chunk to the client over the open HTTP connection.

A conceptual implementation would look like this:

Python

\# Conceptual SSE generator for a web framework  
def event\_generator(process\_reader):  
    \# Loop as long as the 7-Zip process is running  
    while process\_reader.is\_running():  
        try:  
            \# Non-blocking read from the queue  
            line \= process\_reader.readline\_nowait()  
            if line:  
                progress \= parse\_7zip\_progress(line)  
                if progress is not None:  
                    \# Format and yield a 'progress' event  
                    payload \= {"percent": progress}  
                    yield f"event: progress\\ndata: {json.dumps(payload)}\\n\\n"  
        except queue.Empty:  
            \# No new data; yield a keep-alive comment to prevent timeout  
            yield ": keep-alive\\n\\n"  
            time.sleep(0.1)  \# Avoid a tight, CPU-intensive loop

    \# Send a final 'complete' event  
    final\_status \= {"status": "complete", "return\_code": process\_reader.get\_return\_code()}  
    yield f"event: complete\\ndata: {json.dumps(final\_status)}\\n\\n"

### **3.3 Critical Deployment Considerations: The Need for Asynchronicity**

A crucial and often overlooked aspect of implementing SSE is the dependency it places on the underlying web server. Standard synchronous WSGI servers, including Flask's built-in development server, typically handle requests one at a time using a pool of synchronous workers.8 Because an SSE connection is designed to be held open indefinitely, a single SSE client would monopolize one of these workers, preventing it from handling any other requests and effectively stalling the server.

Therefore, a production deployment of an application with an SSE endpoint **must** use a server capable of handling many concurrent, long-lived connections. This means using either:

* An ASGI server like Uvicorn or Hypercorn, which is the standard for modern async frameworks like FastAPI.15  
* A WSGI server configured with asynchronous workers, such as Gunicorn running with gevent or eventlet worker classes.8

This requirement is non-negotiable. A developer might create a perfectly functional SSE endpoint that works flawlessly with a development server, only to see it fail catastrophically in a production environment using a standard synchronous Gunicorn configuration. This highlights the tight coupling between the application-level protocol (SSE) and the deployment infrastructure (async workers).

---

## **Chapter 4: Synthesis: An End-to-End Implementation**

This chapter integrates the previously discussed components into a cohesive, fully functional application. It presents the complete backend architecture, data flow, and code, demonstrating how the pieces connect to form a robust real-time progress streaming service.

### **4.1 Application Architecture Overview**

The service is structured around a simple RESTful API with two primary endpoints, managed by a central application process.

**API Endpoints:**

* POST /compress: This endpoint initiates a new compression job. The request body would contain parameters such as the source files and the destination archive name. Upon receiving a request, the server instantiates a SubprocessReader with the appropriate 7-Zip command, starts the process, and stores a reference to it. It then returns a unique job\_id (e.g., a UUID) to the client, which is used to track this specific operation.  
* GET /progress/{job\_id}: This is the SSE endpoint. A client, having received a job\_id from the /compress endpoint, connects to this URL. The server uses the job\_id to look up the corresponding active SubprocessReader instance and begins streaming its progress.

State Management:  
For simplicity, this implementation will use a global, in-memory Python dictionary to manage the state of active jobs. This dictionary will map each job\_id to its SubprocessReader instance. While sufficient for a single-process demonstration, a production-grade system designed for scalability would replace this with a more robust external store, such as a Redis database, to share job state across multiple server processes or nodes.  
**Data Flow:**

1. The client sends a POST request to /compress with job details.  
2. The Python server validates the request, generates a unique job\_id, creates a SubprocessReader instance for the 7-Zip command, and stores it in the job management dictionary: jobs\[job\_id\] \= reader.  
3. The server immediately responds with the job\_id.  
4. The client's front-end uses this job\_id to establish a connection to the SSE endpoint: GET /progress/{job\_id}.  
5. The SSE endpoint handler retrieves the correct SubprocessReader instance from the jobs dictionary.  
6. The SSE generator function begins its loop, polling the reader's output queue.  
7. As progress lines are read from the queue, they are parsed to extract the percentage.  
8. The percentage is formatted into a JSON payload and yielded as a valid SSE message (e.g., event: progress\\ndata: {"percent": 85}\\n\\n).  
9. This process continues until the 7-Zip subprocess terminates, at which point a final 'complete' or 'error' event is sent, and the connection is closed.

### **4.2 Complete Python Backend Code (FastAPI)**

The following presents a complete, commented implementation using the FastAPI framework, which is well-suited for this task due to its native support for asynchronous operations and streaming responses.

Python

import asyncio  
import queue  
import re  
import subprocess  
import threading  
import uuid  
from typing import Dict, Optional

from fastapi import FastAPI, Request  
from fastapi.responses import StreamingResponse  
from pydantic import BaseModel

app \= FastAPI()

\# In-memory store for active jobs. Use Redis for production.  
active\_jobs: Dict \= {}

class SubprocessReader:  
    """  
    A class to run a subprocess and read its output stream (stderr)  
    in a non-blocking way using a separate thread.  
    """  
    def \_\_init\_\_(self, command\_args: list):  
        self.\_command\_args \= command\_args  
        self.\_process \= None  
        self.\_output\_queue \= queue.Queue()  
        self.\_thread \= None

    def start(self):  
        """Starts the subprocess and the reader thread."""  
        self.\_process \= subprocess.Popen(  
            self.\_command\_args,  
            stdout=subprocess.PIPE,  
            stderr=subprocess.PIPE,  
            text=True,  
            encoding='utf-8',  
            errors='replace'  
        )  
        self.\_thread \= threading.Thread(target=self.\_enqueue\_output)  
        self.\_thread.daemon \= True  
        self.\_thread.start()

    def \_enqueue\_output(self):  
        """Reads lines from the process's stderr and puts them in a queue."""  
        \# The \\r is the key character in 7-Zip's progress output  
        for char in iter(lambda: self.\_process.stderr.read(1), ''):  
            self.\_output\_queue.put(char)  
        self.\_process.stderr.close()

    def read\_line\_nowait(self) \-\> Optional\[str\]:  
        """Reads a line from the queue without blocking."""  
        \# Reconstruct lines from single characters  
        line\_buffer \= ""  
        while True:  
            try:  
                char \= self.\_output\_queue.get\_nowait()  
                if char \== '\\r' or char \== '\\n':  
                    if line\_buffer: \# Return completed line  
                        return line\_buffer  
                else:  
                    line\_buffer \+= char  
            except queue.Empty:  
                return None \# No more characters available right now

    def is\_running(self) \-\> bool:  
        """Checks if the subprocess is still running."""  
        return self.\_process is not None and self.\_process.poll() is None

    def get\_return\_code(self) \-\> Optional\[int\]:  
        """Gets the return code of the completed process."""  
        return self.\_process.returncode if self.\_process else None

def parse\_7zip\_progress(line: str) \-\> Optional\[int\]:  
    """Parses a 7-Zip progress line to extract the percentage."""  
    match \= re.search(r'(\\d{1,3})%', line)  
    if match:  
        return int(match.group(1))  
    return None

class CompressionRequest(BaseModel):  
    archive\_name: str  
    files\_to\_compress: str

@app.post("/compress")  
async def start\_compression(request\_data: CompressionRequest):  
    """Starts a 7-Zip compression job and returns a job ID."""  
    job\_id \= str(uuid.uuid4())  
      
    \# Example command: 7z a \-bsp2 \-bso0 archive.7z \*  
    command \=  
      
    reader \= SubprocessReader(command)  
    reader.start()  
    active\_jobs\[job\_id\] \= reader  
      
    return {"job\_id": job\_id}

@app.get("/progress/{job\_id}")  
async def stream\_progress(job\_id: str, request: Request):  
    """Streams the progress of a specific job using SSE."""  
    if job\_id not in active\_jobs:  
        return {"error": "Job not found"}, 404

    reader \= active\_jobs\[job\_id\]

    async def event\_generator():  
        last\_percent \= \-1  
        try:  
            while reader.is\_running():  
                if await request.is\_disconnected():  
                    break  
                  
                line \= reader.read\_line\_nowait()  
                if line:  
                    percent \= parse\_7zip\_progress(line)  
                    if percent is not None and percent \> last\_percent:  
                        last\_percent \= percent  
                        yield f"event: progress\\ndata: {{\\"percent\\": {percent}}}\\n\\n"  
                  
                await asyncio.sleep(0.1) \# Prevent busy-waiting  
              
            \# Final event  
            return\_code \= reader.get\_return\_code()  
            status \= "complete" if return\_code \== 0 else "error"  
            yield f"event: {status}\\ndata: {{\\"return\_code\\": {return\_code}}}\\n\\n"  
        finally:  
            \# Clean up the job from the dictionary  
            if job\_id in active\_jobs:  
                del active\_jobs\[job\_id\]

    return StreamingResponse(event\_generator(), media\_type="text/event-stream")

### **4.3 Error Handling and Graceful Shutdown**

A production-ready system must handle various failure modes gracefully.

* **Process Errors:** After the SubprocessReader loop completes, the final return code of the 7-Zip process is checked. A return code of 0 typically indicates success, while any non-zero value signifies an error. This status is communicated to the client via a final SSE event, such as event: complete or event: error, allowing the UI to display a success message or an error state.  
* **Client Disconnects:** The SSE generator must detect when a client closes the connection to avoid unnecessary work and to clean up resources. Modern ASGI frameworks provide a mechanism for this, such as request.is\_disconnected() in Starlette/FastAPI.15 When a disconnect is detected, the generator loop is terminated.  
* **Process Termination:** For a fully featured application, an additional API endpoint (e.g., POST /cancel/{job\_id}) could be implemented. This endpoint would look up the running process associated with the job ID and use the process.terminate() or process.kill() methods to stop the 7-Zip operation prematurely.

---

## **Chapter 5: Verification and Client-Side Integration**

The final stage involves verifying the backend's functionality and integrating the SSE stream into a client-side application to display the progress to the user.

### **5.1 Command-Line Verification with curl**

Before writing any front-end code, it is essential to verify that the SSE endpoint is behaving correctly. The command-line utility curl is the ideal tool for this task, allowing for direct inspection of the raw event stream.21

To connect to the SSE stream, one would first initiate a job via a POST request and then use the returned job\_id to connect to the progress endpoint. The \-N or \--no-buffer flag is critical, as it disables curl's default output buffering, ensuring that events are printed to the terminal as soon as they are received from the server.22

**Verification Steps:**

1. **Start the Job:**  
   Bash  
   curl \-X POST http://localhost:8000/compress \\  
   \-H "Content-Type: application/json" \\  
   \-d '{"archive\_name": "my\_archive.7z", "files\_to\_compress": "./\*"}'  
   \# The server responds with: {"job\_id":"some-uuid-string"}

2. **Listen to the Stream:**  
   Bash  
   curl \-N http://localhost:8000/progress/some-uuid-string

Expected Output:  
The terminal will display the raw SSE messages in real-time as the compression runs:

event: progress  
data: {"percent": 5}

event: progress  
data: {"percent": 12}

...

event: progress  
data: {"percent": 98}

event: complete  
data: {"return\_code": 0}

This simple verification step provides a rapid and isolated debugging loop. The backend developer can perfect the server logic, stream formatting, and error handling entirely, without the complexities of a browser or JavaScript environment. This separation of concerns dramatically improves development efficiency. Furthermore, the fact that the stream is consumable via a standard tool like curl demonstrates its broader utility. It is not merely a UI feature but a machine-readable, real-time data feed that could be consumed by other backend services, integrated into CI/CD pipelines, or used for automated system monitoring.23

### **5.2 Front-End Integration with JavaScript's EventSource API**

On the client side, modern browsers provide a native EventSource API for consuming SSE streams. This API is straightforward and handles connection management, message parsing, and automatic reconnection transparently.14

**Minimal HTML Structure:**

HTML

\<\!DOCTYPE **html**\>  
\<html\>  
\<head\>  
    \<title\>7-Zip Progress\</title\>  
    \<style\>  
        \#progressBarContainer { width: 500px; border: 1px solid \#ccc; }  
        \#progressBar { width: 0%; height: 30px; background-color: \#4CAF50; text-align: center; line-height: 30px; color: white; }  
    \</style\>  
\</head\>  
\<body\>  
    \<h1\>Compression Progress\</h1\>  
    \<button id\="startButton"\>Start Compression\</button\>  
    \<div id\="progressBarContainer"\>  
        \<div id\="progressBar"\>0%\</div\>  
    \</div\>  
    \<p id\="status"\>\</p\>  
\</body\>  
\<script src\="app.js"\>\</script\>  
\</html\>

**JavaScript Implementation (app.js):**

JavaScript

document.getElementById('startButton').addEventListener('click', startCompression);

async function startCompression() {  
    const progressBar \= document.getElementById('progressBar');  
    const status \= document.getElementById('status');  
      
    progressBar.style.width \= '0%';  
    progressBar.textContent \= '0%';  
    status.textContent \= 'Starting job...';

    try {  
        // Step 1: Start the compression job  
        const response \= await fetch('/compress', {  
            method: 'POST',  
            headers: { 'Content-Type': 'application/json' },  
            body: JSON.stringify({  
                archive\_name: 'my\_large\_archive.7z',  
                files\_to\_compress: '\*' // Adjust as needed  
            })  
        });

        if (\!response.ok) {  
            throw new Error('Failed to start compression job.');  
        }

        const data \= await response.json();  
        const jobId \= data.job\_id;  
        status.textContent \= \`Job started with ID: ${jobId}. Waiting for progress...\`;

        // Step 2: Connect to the SSE stream  
        const source \= new EventSource(\`/progress/${jobId}\`);

        source.onopen \= () \=\> {  
            console.log('SSE connection established.');  
        };

        // Listen for custom 'progress' events  
        source.addEventListener('progress', (event) \=\> {  
            const progressData \= JSON.parse(event.data);  
            const percent \= progressData.percent;  
            progressBar.style.width \= \`${percent}%\`;  
            progressBar.textContent \= \`${percent}%\`;  
        });  
          
        // Listen for the final 'complete' event  
        source.addEventListener('complete', (event) \=\> {  
            status.textContent \= 'Compression completed successfully\!';  
            progressBar.style.width \= '100%';  
            progressBar.textContent \= '100%';  
            source.close(); // Close the connection  
        });

        // Listen for the final 'error' event  
        source.addEventListener('error', (event) \=\> {  
            status.textContent \= 'An error occurred during compression.';  
            progressBar.style.backgroundColor \= '\#f44336'; // Turn progress bar red  
            source.close(); // Close the connection  
        });

        source.onerror \= (err) \=\> {  
            console.error('EventSource failed:', err);  
            status.textContent \= 'Connection to server lost.';  
            source.close();  
        };

    } catch (error) {  
        status.textContent \= \`Error: ${error.message}\`;  
    }  
}

This client-side code demonstrates the complete workflow: it initiates the job, then creates an EventSource instance pointing to the unique progress URL. It registers listeners for the custom progress, complete, and error events sent by the server. As 'progress' events arrive, the event handler parses the JSON payload and updates the width and text of the progress bar, providing the user with seamless, real-time feedback.

---

## **Conclusion: A Blueprint for Real-Time Application Monitoring**

This report has detailed a complete, end-to-end architecture for capturing the progress of a command-line utility and streaming it to a web front-end. The solution successfully navigates the primary technical challenges through a series of robust architectural patterns. The esoteric \-bs switch of 7-Zip was deconstructed to reliably extract progress data. The inherent problem of blocking I/O was solved in a cross-platform manner using the Thread-Queue-Reader pattern in Python. Finally, Server-Sent Events were leveraged as a simple, efficient, and resilient transport protocol for delivering real-time updates to the client.

The significance of this architecture extends far beyond the specific use case of 7-Zip. It serves as a powerful and reusable blueprint for modernizing any interactive or long-running command-line utility. The core principles—isolating process output, managing subprocesses with non-blocking I/O, and exposing the output via a standardized streaming API—can be applied to a vast array of tools, from data processing pipelines and scientific computing tasks to software builds and system administration scripts. This approach effectively wraps a legacy interface in a modern, event-driven service, making it accessible to web applications, microservices, and automated workflows.

Potential future enhancements could further increase the robustness and scalability of this system. Replacing the in-memory job dictionary with a distributed key-value store like Redis would allow the service to be scaled horizontally across multiple nodes. Implementing authentication and authorization on the API endpoints would secure the service for multi-tenant environments. By building upon this foundational architecture, developers can create sophisticated, transparent, and user-friendly systems that provide critical real-time insight into the status of complex backend processes.

#### **Works cited**

1. How to show extraction progress of 7zip inside cmd? \- Super User, accessed October 4, 2025, [https://superuser.com/questions/702122/how-to-show-extraction-progress-of-7zip-inside-cmd](https://superuser.com/questions/702122/how-to-show-extraction-progress-of-7zip-inside-cmd)  
2. c\# \- Read 7Zip progress using from Process.StandardOuput \- Stack Overflow, accessed October 4, 2025, [https://stackoverflow.com/questions/64651915/read-7zip-progress-using-from-process-standardouput](https://stackoverflow.com/questions/64651915/read-7zip-progress-using-from-process-standardouput)  
3. \-spf (Use fully qualified file paths) switch \- 7-Zip, accessed October 4, 2025, [https://7-zip.opensource.jp/chm/cmdline/switches/bs.htm](https://7-zip.opensource.jp/chm/cmdline/switches/bs.htm)  
4. Tracking progress of 7zip command line to create a zip archive \- Super User, accessed October 4, 2025, [https://superuser.com/questions/1196459/tracking-progress-of-7zip-command-line-to-create-a-zip-archive](https://superuser.com/questions/1196459/tracking-progress-of-7zip-command-line-to-create-a-zip-archive)  
5. When I use zip, how can I display the overall progress without flooding the command line?, accessed October 4, 2025, [https://unix.stackexchange.com/questions/179563/when-i-use-zip-how-can-i-display-the-overall-progress-without-flooding-the-comm](https://unix.stackexchange.com/questions/179563/when-i-use-zip-how-can-i-display-the-overall-progress-without-flooding-the-comm)  
6. Python: How to read stdout of subprocess in a nonblocking way \- Stack Overflow, accessed October 4, 2025, [https://stackoverflow.com/questions/36476841/python-how-to-read-stdout-of-subprocess-in-a-nonblocking-way](https://stackoverflow.com/questions/36476841/python-how-to-read-stdout-of-subprocess-in-a-nonblocking-way)  
7. Non-blocking call to subprocess, but response still delayed... Please explain\! : Forums \- PythonAnywhere, accessed October 4, 2025, [https://www.pythonanywhere.com/forums/topic/3555/](https://www.pythonanywhere.com/forums/topic/3555/)  
8. Quickstart — Flask-SSE 1.0.0 documentation \- Read the Docs, accessed October 4, 2025, [https://flask-sse.readthedocs.io/en/latest/quickstart.html](https://flask-sse.readthedocs.io/en/latest/quickstart.html)  
9. Can read() be non-blocking? | Python \- Coding Forums, accessed October 4, 2025, [https://www.thecodingforums.com/threads/can-read-be-non-blocking.643344/](https://www.thecodingforums.com/threads/can-read-be-non-blocking.643344/)  
10. io \- A non-blocking read on a subprocess.PIPE in Python \- Stack ..., accessed October 4, 2025, [https://stackoverflow.com/questions/375427/a-non-blocking-read-on-a-subprocess-pipe-in-python](https://stackoverflow.com/questions/375427/a-non-blocking-read-on-a-subprocess-pipe-in-python)  
11. Non-blocking readline : r/learnpython \- Reddit, accessed October 4, 2025, [https://www.reddit.com/r/learnpython/comments/1703b9r/nonblocking\_readline/](https://www.reddit.com/r/learnpython/comments/1703b9r/nonblocking_readline/)  
12. subprocess — Subprocess management — Python 3.13.7 documentation, accessed October 4, 2025, [https://docs.python.org/3/library/subprocess.html](https://docs.python.org/3/library/subprocess.html)  
13. Server-sent events \- Web APIs | MDN \- Mozilla, accessed October 4, 2025, [https://developer.mozilla.org/en-US/docs/Web/API/Server-sent\_events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events)  
14. A simple guide to Server Sent Events (SSE) and EventSource | by Omer Keskinkilic | Pon.Tech.Talk | Medium, accessed October 4, 2025, [https://medium.com/pon-tech-talk/a-simple-guide-to-server-sent-events-sse-and-eventsource-9de19c23645b](https://medium.com/pon-tech-talk/a-simple-guide-to-server-sent-events-sse-and-eventsource-9de19c23645b)  
15. Introducing Server-Sent Events in Python \- Towards Data Science, accessed October 4, 2025, [https://towardsdatascience.com/introducing-server-sent-events-in-python/](https://towardsdatascience.com/introducing-server-sent-events-in-python/)  
16. Stream updates with server-sent events | Articles \- web.dev, accessed October 4, 2025, [https://web.dev/articles/eventsource-basics](https://web.dev/articles/eventsource-basics)  
17. Real-Time Notifications in Python: Using SSE with FastAPI | by İnan DELİBAŞ | Medium, accessed October 4, 2025, [https://medium.com/@inandelibas/real-time-notifications-in-python-using-sse-with-fastapi-1c8c54746eb7](https://medium.com/@inandelibas/real-time-notifications-in-python-using-sse-with-fastapi-1c8c54746eb7)  
18. Using server-sent events \- Web APIs | MDN, accessed October 4, 2025, [https://developer.mozilla.org/en-US/docs/Web/API/Server-sent\_events/Using\_server-sent\_events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events)  
19. 9.2 Server-sent events \- HTML Standard \- WhatWG, accessed October 4, 2025, [https://html.spec.whatwg.org/multipage/server-sent-events.html](https://html.spec.whatwg.org/multipage/server-sent-events.html)  
20. Server-sent events in Flask without extra dependencies \- Max Halford, accessed October 4, 2025, [https://maxhalford.github.io/blog/flask-sse-no-deps/](https://maxhalford.github.io/blog/flask-sse-no-deps/)  
21. curl man page, accessed October 4, 2025, [https://curl.se/docs/manpage.html](https://curl.se/docs/manpage.html)  
22. Pipe the result of a cut command to curl \- Unix & Linux Stack Exchange, accessed October 4, 2025, [https://unix.stackexchange.com/questions/323604/pipe-the-result-of-a-cut-command-to-curl](https://unix.stackexchange.com/questions/323604/pipe-the-result-of-a-cut-command-to-curl)  
23. How to Pipe Data to cURL POST Requests | Baeldung on Linux, accessed October 4, 2025, [https://www.baeldung.com/linux/pipe-data-curl-post-requests](https://www.baeldung.com/linux/pipe-data-curl-post-requests)  
24. How do I pipe the output of uptime/df to curl? \- linux \- Server Fault, accessed October 4, 2025, [https://serverfault.com/questions/313599/how-do-i-pipe-the-output-of-uptime-df-to-curl](https://serverfault.com/questions/313599/how-do-i-pipe-the-output-of-uptime-df-to-curl)  
25. pipe or redirect output from curl to ssh command \- Unix & Linux Stack Exchange, accessed October 4, 2025, [https://unix.stackexchange.com/questions/772945/pipe-or-redirect-output-from-curl-to-ssh-command](https://unix.stackexchange.com/questions/772945/pipe-or-redirect-output-from-curl-to-ssh-command)  
26. The simplest demo on SSE(Server-Send Events) \- DEV Community, accessed October 4, 2025, [https://dev.to/tom-takeru/the-simplest-demo-on-sseserver-send-events-1mib](https://dev.to/tom-takeru/the-simplest-demo-on-sseserver-send-events-1mib)