plugins {
    id("com.android.application") version "9.4.0"
    id("com.android.library") version "9.4.0" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "2.4.10"
    id("com.cefrium") version "0.9.0"
}

val termuxConsumer = rootProject.name == "te2-termux"
val termuxKey = providers.environmentVariable("ELECTROMUX_KEYSTORE").orNull
val termuxBackendAssets = if (termuxConsumer) tasks.register<Exec>("bundleTermuxBackend") {
    workingDir("../..")
    commandLine("node", "desktop_client/electromux/build.mjs")
    inputs.files(fileTree("../../desktop_client/electromux") { include("*.ts", "*.mjs") },
        fileTree("../../desktop_client/electron/src/main") { include("**/*.ts") },
        fileTree("../../desktop_client/electron/src/shared") { include("**/*.ts") })
    outputs.file("../../desktop_client/electromux/dist/local-framework-backend.mjs")
} else null
val termuxShellAssets = if (termuxConsumer) tasks.register<Sync>("bundleTermuxShell") {
    dependsOn(checkNotNull(termuxBackendAssets))
    from("../../desktop_client/android_shell")
    into(layout.buildDirectory.dir("generated/termuxShellAssets/electromux_shell"))
    filesMatching("*.html") {
        filter { line: String -> line.replace("src=\"./launcher.js\"", "src=\"./electromux-bootstrap.js\"")
            .replace("src=\"./settings.js\"", "src=\"./electromux-bootstrap.js\"")
            .replace("<script type=\"module\"", "<script src=\"./electromux-bridge.js\"></script><script type=\"module\"") }
    }
} else null
val termuxActorAssets = if (termuxConsumer) tasks.register<Sync>("bundleTermuxActorAssets") {
    dependsOn(checkNotNull(termuxBackendAssets))
    from("../../desktop_client/electromux/dist/local-framework-backend.mjs")
    into(layout.buildDirectory.dir("generated/termuxShellAssets/electromux_backend"))
} else null

android {
    namespace = "com.termux.extensions"
    compileSdk = 37

    defaultConfig {
        applicationId = if (termuxConsumer) "com.termux.extensions.te2termux" else "com.termux.extensions.cefrium"
        minSdk = 29
        targetSdk = 34
        versionCode = 20352
        versionName = if (termuxConsumer) "0.0.1-te2-termux-poc" else "1.0.8-r0.2.352-cefrium"
        buildConfigField("boolean", "TE2_TERMUX", termuxConsumer.toString())

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        manifestPlaceholders["sharedUserIdValue"] = "com.termux.extensions.cefrium"

        ndk {
            abiFilters += setOf("arm64-v8a")
        }
    }

    signingConfigs {
        getByName("debug") {
            if (!termuxConsumer) {
                storeFile = file("../signing/te2-development.keystore")
                storePassword = "android"
                keyAlias = "androiddebugkey"
                keyPassword = "android"
            } else if (termuxKey != null) {
                storeFile = file(termuxKey)
                storePassword = providers.environmentVariable("ELECTROMUX_STORE_PASSWORD").get()
                keyAlias = providers.environmentVariable("ELECTROMUX_KEY_ALIAS").get()
                keyPassword = providers.environmentVariable("ELECTROMUX_KEY_PASSWORD").get()
            }
        }
    }

    buildTypes {
        debug {
            signingConfig = signingConfigs.getByName("debug")
            isMinifyEnabled = false
        }
        release {
            isMinifyEnabled = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "../app/proguard-rules.pro",
                "../cefrium/proguard-rules.pro",
            )
        }
        create("staging") {
            isDebuggable = false
            isMinifyEnabled = true
            isShrinkResources = true
            signingConfig = signingConfigs.getByName("debug")
            matchingFallbacks += listOf("release")
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "../app/proguard-rules.pro",
                "../cefrium/proguard-rules.pro",
            )
        }
    }

    androidResources {
        noCompress += listOf("dat", "pak", "bin")
    }

    packaging {
        jniLibs {
            useLegacyPackaging = true
            excludes += setOf("lib/*/libVkLayer_khronos_validation.so")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    sourceSets {
        // AGP 9 does not infer shared Kotlin sources from java.srcDir.
        // Keep debug reflection and release stubs isolated in every variant.
        getByName("testDebug") {
            java.srcDir("../app/src/testDebug/java")
            kotlin.srcDir("../app/src/testDebug/java")
        }
        getByName("debug") {
            java.srcDir("../app/src/debug/java")
            kotlin.srcDir("../app/src/debug/java")
            manifest.srcFile("../app/src/debug/AndroidManifest.xml")
        }
        getByName("release") {
            java.srcDir("../app/src/nonDebug/java")
            kotlin.srcDir("../app/src/nonDebug/java")
        }
        getByName("staging") {
            java.srcDir("../app/src/nonDebug/java")
            kotlin.srcDir("../app/src/nonDebug/java")
        }
        getByName("main") {
            java.srcDir("../cefrium/src/main/java")
            kotlin.srcDir("../cefrium/src/main/java")
            res.srcDir("../cefrium/src/main/res")
            java.srcDir("../app/src/main/java")
            kotlin.srcDir("../app/src/main/java")
            res.srcDir("../app/src/main/res")
            assets.srcDir("../app/src/main/assets")
            if (termuxConsumer) {
                assets.srcDir(layout.buildDirectory.dir("generated/termuxShellAssets").get().asFile)
                java.srcDir("../termux/src/main/java")
                kotlin.srcDir("../termux/src/main/java")
            } else {
                java.srcDir("src/nonTermux/java")
                kotlin.srcDir("src/nonTermux/java")
            }
        }
    }
}

configurations.all {
    exclude(group = "com.google.guava", module = "listenablefuture")
}

dependencies {
    if (termuxConsumer) implementation(project(":electromux-host"))
    debugImplementation("org.jetbrains.kotlin:kotlin-reflect:2.2.10")
    val composeBom = platform("androidx.compose:compose-bom:2026.08.00")

    // Cefrium 0.9.0 publishes this as Maven `provided`, which Gradle does not
    // place on the consumer compile/R8 classpath. Keep the extracted classes
    // JAR until the upstream Gradle metadata supplies an equivalent dependency.
    if (termuxConsumer) compileOnly(files("../cefrium/libs/window-extensions-core-1.0.0.jar"))
    else compileOnly(files("libs/window-extensions-core-1.0.0.jar"))
    implementation("com.cefrium:cefrium-sdk:0.9.0")
    implementation("androidx.core:core-ktx:1.16.0")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.browser:browser:1.8.0")
    implementation("androidx.mediarouter:mediarouter:1.7.0")
    implementation("androidx.activity:activity-compose:1.8.2")
    implementation("org.jetbrains.kotlin:kotlin-stdlib:1.8.22")
    implementation(composeBom)
    androidTestImplementation(composeBom)
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("com.squareup.okhttp3:okhttp-sse:4.12.0")
    implementation("io.socket:socket.io-client:2.1.1")
    implementation("org.msgpack:msgpack-core:0.9.12")
    debugImplementation("androidx.compose.ui:ui-tooling")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20090211")
    androidTestImplementation("androidx.test.ext:junit:1.1.5")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.1")
}

if (termuxShellAssets != null) tasks.named("preBuild") { dependsOn(termuxShellAssets) }
if (termuxActorAssets != null) tasks.named("preBuild") { dependsOn(termuxActorAssets) }
gradle.taskGraph.whenReady {
    if (termuxConsumer && termuxKey == null && allTasks.any {
        it.name.matches(Regex("(assemble|package|bundle|sign|install)(Debug|Release|Staging)(AndroidTest|UniversalApk|Bundle)?")) ||
            it.name == "assemble" || it.name == "bundle"
    }) error("TE2 Termux APK assembly requires explicit Termux-compatible ELECTROMUX signing configuration")
}
