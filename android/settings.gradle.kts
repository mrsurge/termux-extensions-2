pluginManagement {
    repositories {
        maven("https://codeberg.org/api/packages/cefrium/maven")
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.PREFER_SETTINGS)
    repositories {
        google()
        mavenCentral()
        maven("https://codeberg.org/api/packages/cefrium/maven")
        maven {
            url = uri("https://maven.mozilla.org/maven2/")
        }
    }
}

rootProject.name = "TermuxExtensions"
include(":app")
// :cefrium is built as an independent Gradle build (android/cefrium/), not a
// subproject here. Cefrium 0.8.0 requires AGP 9.4+/Gradle 9.7.1+/JDK 25, which
// is a project-wide (not per-module) toolchain in Gradle -- it cannot coexist
// in one build with :app's AGP 8.9.1/Gradle 8.11/JDK 17. See android/cefrium/README.md.
