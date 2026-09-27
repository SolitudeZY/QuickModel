plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}
android {
    namespace = "com.quickmodel.mobile"
    compileSdk = 35
    defaultConfig {
        applicationId = "com.quickmodel.mobile"
        minSdk = 28
        targetSdk = 35
        versionCode = 3
        versionName = "0.3.0"
    }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
    // Personal preview signing key remains in the Android user directory, never in the repository.
    buildTypes { getByName("release") { isMinifyEnabled = false; signingConfig = signingConfigs.getByName("debug") } }
    sourceSets.getByName("main").assets.srcDir("../../mobile_web")
}
dependencies { implementation("androidx.webkit:webkit:1.12.1") }
