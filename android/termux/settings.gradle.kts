pluginManagement {
    repositories {
        google()
        mavenCentral()
        maven("https://codeberg.org/api/packages/cefrium/maven")
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.PREFER_SETTINGS)
    repositories {
        google()
        mavenCentral()
        maven("https://codeberg.org/api/packages/cefrium/maven")
    }
}
rootProject.name = "te2-termux"
// One actual build definition and renderer source, not a forked Android client.
rootProject.buildFileName = "../cefrium/build.gradle.kts"
