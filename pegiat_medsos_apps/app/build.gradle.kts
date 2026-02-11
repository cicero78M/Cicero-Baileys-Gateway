import java.util.Properties
val envProps = Properties()

plugins {
    id("com.android.application")
    kotlin("android")
}



val envFile = rootProject.file(".env")
if (envFile.exists()) {
    envFile.inputStream().use { envProps.load(it) }
}

fun env(name: String): String =
    envProps.getProperty(name) ?: System.getenv(name) ?: ""


android {
    namespace = "com.cicero.repostapp"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.cicero.repostapp"
        minSdk = 26
        //noinspection EditedTargetSdkVersion
        targetSdk = 34
        versionCode = 1
        versionName = "1.5.2"
        buildConfigField("String", "TWITTER_CONSUMER_KEY", "\"${env("TWITTER_CONSUMER_KEY")}\"")
        buildConfigField("String", "TWITTER_CONSUMER_SECRET", "\"${env("TWITTER_CONSUMER_SECRET")}\"")
        val callback = env("TWITTER_CALLBACK_URL").ifEmpty { "repostapp-twitter://callback" }
        buildConfigField("String", "TWITTER_CALLBACK_URL", "\"$callback\"")
        buildConfigField("String", "TWITTER_ACCESS_TOKEN", "\"${env("TWITTER_ACCESS_TOKEN")}\"")
        buildConfigField("String", "TWITTER_ACCESS_SECRET", "\"${env("TWITTER_ACCESS_SECRET")}\"")
        buildConfigField("String", "YOUTUBE_CLIENT_ID", "\"${env("YOUTUBE_CLIENT_ID")}\"")
        val ytRedirect = env("YOUTUBE_REDIRECT_URI").ifEmpty { "repostapp-youtube://oauth" }
        buildConfigField("String", "YOUTUBE_REDIRECT_URI", "\"$ytRedirect\"")
        buildConfigField("String", "YOUTUBE_API_KEY", "\"${env("YOUTUBE_API_KEY")}\"")
        val apiBase = env("API_BASE_URL").ifEmpty { "https://papiqo.com" }
        buildConfigField("String", "API_BASE_URL", "\"$apiBase\"")
    }

    buildFeatures {
        buildConfig = true
        viewBinding = true
    }

    buildTypes {
        getByName("release") {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

kotlin {
    jvmToolchain(17)
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.6.1")
    implementation("com.google.android.material:material:1.11.0") {
        exclude(group = "com.google.errorprone", module = "error_prone_annotations")
    }
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.7.3")
    implementation("androidx.fragment:fragment-ktx:1.6.2")
    implementation("androidx.viewpager2:viewpager2:1.0.0")
    implementation("androidx.recyclerview:recyclerview:1.4.0")
    implementation("androidx.constraintlayout:constraintlayout:2.1.4")
    implementation("com.github.bumptech.glide:glide:4.16.0")
    implementation("androidx.security:security-crypto:1.1.0-alpha06")
    implementation("com.google.code.gson:gson:2.10.1")
    implementation("com.github.instagram4j:instagram4j:2.0.7")
    implementation("org.twitter4j:twitter4j-core:4.0.7")
    implementation("com.github.scribejava:scribejava-core:8.3.3")
    implementation("com.github.scribejava:scribejava-apis:8.3.3")
    // Align with the version pulled in by the Android Gradle plugin to avoid
    // dependency resolution conflicts during the build.
    compileOnly("com.google.errorprone:error_prone_annotations:2.15.0")


    testImplementation("junit:junit:4.13.2")
}
