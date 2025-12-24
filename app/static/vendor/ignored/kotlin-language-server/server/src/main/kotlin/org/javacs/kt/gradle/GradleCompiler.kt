package org.javacs.kt.gradle

import org.javacs.kt.LOG
import java.io.File
import java.nio.file.Path
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

/**
 * Result of a Gradle compilation.
 */
data class GradleCompileResult(
    val exitCode: Int,
    val output: String,
    val durationMs: Long,
    val wasCancelled: Boolean = false
) {
    val success: Boolean get() = exitCode == 0
}

/**
 * Configuration for GradleCompiler.
 */
data class GradleCompilerConfig(
    val module: String = "app",
    val variant: String = "Debug",
    val useNoDeamon: Boolean = true,
    val timeoutSeconds: Long = 300,  // 5 minutes default
    val extraEnv: Map<String, String> = emptyMap()
)

/**
 * Executes Gradle compile tasks for Android projects and captures output.
 * 
 * Designed to be used as the compilation backend for the pseudo-LSP,
 * replacing fwcd's Kotlin compiler integration.
 * 
 * Key features:
 * - Runs Gradle in a subprocess with captured stdout/stderr
 * - Supports cancellation of in-flight builds
 * - Configurable module/variant
 * - Passes through environment (important for PATH containing aapt2)
 */
class GradleCompiler(
    private val projectRoot: Path,
    private val config: GradleCompilerConfig = GradleCompilerConfig()
) {
    
    private val currentProcess = AtomicReference<Process?>(null)
    private val cancelled = AtomicBoolean(false)
    
    /**
     * Run compileDebugKotlin (or compileReleaseKotlin based on variant).
     * This is a fast compilation that catches Kotlin errors without full APK build.
     */
    fun compileKotlin(): GradleCompileResult {
        val task = ":${config.module}:compile${config.variant}Kotlin"
        return runGradleTask(task)
    }
    
    /**
     * Run assembleDebug (or assembleRelease based on variant).
     * This is a full APK build - slower but catches all errors including resources.
     */
    fun assemble(): GradleCompileResult {
        val task = ":${config.module}:assemble${config.variant}"
        return runGradleTask(task)
    }
    
    /**
     * Run compileDebugJavaWithJavac to catch Java errors.
     */
    fun compileJava(): GradleCompileResult {
        val task = ":${config.module}:compile${config.variant}JavaWithJavac"
        return runGradleTask(task)
    }
    
    /**
     * Run a custom Gradle task.
     */
    fun runGradleTask(task: String): GradleCompileResult {
        cancelled.set(false)
        
        val gradlew = findGradlew()
        if (gradlew == null) {
            return GradleCompileResult(
                exitCode = 1,
                output = "ERROR: gradlew not found in project root: $projectRoot",
                durationMs = 0
            )
        }
        
        val command = mutableListOf(gradlew.absolutePath, task, "--console=plain")
        if (config.useNoDeamon) {
            command.add("--no-daemon")
        }
        
        LOG.info("Running Gradle: ${command.joinToString(" ")}")
        
        val startTime = System.currentTimeMillis()
        
        try {
            val processBuilder = ProcessBuilder(command)
                .directory(projectRoot.toFile())
                .redirectErrorStream(true)  // Merge stderr into stdout
            
            // Inherit environment and add any extra env vars
            val env = processBuilder.environment()
            
            // Ensure PATH is inherited (important for system aapt2 on Termux)
            System.getenv("PATH")?.let { env["PATH"] = it }
            System.getenv("ANDROID_HOME")?.let { env["ANDROID_HOME"] = it }
            System.getenv("ANDROID_SDK_ROOT")?.let { env["ANDROID_SDK_ROOT"] = it }
            System.getenv("JAVA_HOME")?.let { env["JAVA_HOME"] = it }
            
            // Add any custom env vars from config
            env.putAll(config.extraEnv)
            
            val process = processBuilder.start()
            currentProcess.set(process)
            
            // Read output in a separate thread to avoid blocking
            val outputBuilder = StringBuilder()
            val outputThread = Thread {
                process.inputStream.bufferedReader().use { reader ->
                    var line: String?
                    while (reader.readLine().also { line = it } != null) {
                        outputBuilder.appendLine(line)
                    }
                }
            }
            outputThread.start()
            
            // Wait for process with timeout
            val completed = process.waitFor(config.timeoutSeconds, TimeUnit.SECONDS)
            
            if (!completed) {
                process.destroyForcibly()
                return GradleCompileResult(
                    exitCode = 124,
                    output = outputBuilder.toString() + "\n\nERROR: Gradle build timed out after ${config.timeoutSeconds}s",
                    durationMs = System.currentTimeMillis() - startTime,
                    wasCancelled = true
                )
            }
            
            // Wait for output thread to finish
            outputThread.join(1000)
            
            val durationMs = System.currentTimeMillis() - startTime
            LOG.info("Gradle finished in ${durationMs}ms with exit code ${process.exitValue()}")
            
            return GradleCompileResult(
                exitCode = process.exitValue(),
                output = outputBuilder.toString(),
                durationMs = durationMs,
                wasCancelled = cancelled.get()
            )
            
        } catch (e: Exception) {
            LOG.error("Gradle execution failed: ${e.message}")
            return GradleCompileResult(
                exitCode = 1,
                output = "ERROR: Gradle execution failed: ${e.message}\n${e.stackTraceToString()}",
                durationMs = System.currentTimeMillis() - startTime
            )
        } finally {
            currentProcess.set(null)
        }
    }
    
    /**
     * Cancel any running Gradle build.
     */
    fun cancel() {
        cancelled.set(true)
        currentProcess.get()?.let { process ->
            LOG.info("Cancelling Gradle build")
            process.destroyForcibly()
        }
    }
    
    /**
     * Check if a build is currently running.
     */
    fun isRunning(): Boolean = currentProcess.get() != null
    
    private fun findGradlew(): File? {
        // Try gradlew in project root
        val gradlew = projectRoot.resolve("gradlew").toFile()
        if (gradlew.exists() && gradlew.canExecute()) {
            return gradlew
        }
        
        // Try making it executable
        if (gradlew.exists()) {
            gradlew.setExecutable(true)
            if (gradlew.canExecute()) {
                return gradlew
            }
        }
        
        // Fallback to system gradle
        val systemGradle = File("/usr/bin/gradle")
        if (systemGradle.exists() && systemGradle.canExecute()) {
            return systemGradle
        }
        
        return null
    }
}
