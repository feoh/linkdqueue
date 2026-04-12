# Building and Installing linkdqueue for iOS and Android

This document covers how to build and install linkdqueue on iOS and Android devices.

## Prerequisites

### Flutter SDK

linkdqueue requires Flutter 3.x (tested with 3.41.6+). Install Flutter by following the [official instructions](https://docs.flutter.dev/get-started/install).

Verify your setup:

```bash
flutter doctor
```

Resolve any issues `flutter doctor` reports before proceeding.

### Clone the Repository

```bash
git clone https://github.com/feoh/linkdqueue.git
cd linkdqueue
```

### Install Dependencies

```bash
flutter pub get
```

---

## iOS

### Additional Prerequisites

- A Mac running macOS
- Xcode 15 or later (install from the Mac App Store)
- CocoaPods: `sudo gem install cocoapods`
- An Apple Developer account (required for installing on a physical device or submitting to the App Store)

### Install iOS Dependencies

```bash
cd ios
pod install
cd ..
```

### Run on a Simulator (no account required)

1. Open Xcode and install at least one iOS simulator via **Xcode → Settings → Platforms**.
2. Start the simulator or let Flutter launch it automatically:

```bash
flutter run
```

Flutter will detect available simulators. To target a specific one:

```bash
flutter devices                        # list available devices
flutter run -d "iPhone 16"             # example: run on a named simulator
```

### Install on a Physical Device

1. Connect your iPhone via USB.
2. Open `ios/Runner.xcworkspace` in Xcode.
3. Under **Signing & Capabilities**, select your Apple Developer team and set a unique **Bundle Identifier** (e.g. `com.yourname.linkdqueue`).
4. Trust the developer certificate on the device: **Settings → General → VPN & Device Management**.
5. Run from Flutter:

```bash
flutter run -d <your-device-id>
```

Or build a debug IPA and install via Xcode's Devices & Simulators window.

### Build a Release IPA

```bash
flutter build ipa --release
```

The IPA is created at `build/ios/ipa/linkdqueue.ipa`. Upload it to App Store Connect using Xcode's **Organizer** or Transporter.

> **Note:** The app uses `flutter_secure_storage` for credential storage, which requires the Keychain Sharing entitlement to be configured in Xcode under **Signing & Capabilities** if you encounter Keychain errors during testing.

---

## Android

### Additional Prerequisites

- [Android Studio](https://developer.android.com/studio) or the Android command-line tools
- Android SDK with at least one platform installed (Flutter will prompt if missing)
- Java 17 (required by the project's Gradle configuration)

### Configure the Application ID

The default `applicationId` in `android/app/build.gradle.kts` is `com.example.linkdqueue`. Before distributing, update it to a unique reverse-domain identifier:

```kotlin
// android/app/build.gradle.kts
defaultConfig {
    applicationId = "com.yourname.linkdqueue"
    ...
}
```

### Run on an Emulator

1. In Android Studio, open **Device Manager** and create a virtual device (API 21+ recommended).
2. Start the emulator, then:

```bash
flutter run
```

### Install on a Physical Device

1. Enable **Developer Options** on the device: **Settings → About Phone → tap Build Number 7 times**.
2. Enable **USB Debugging** under Developer Options.
3. Connect via USB and accept the debugging prompt on the device.
4. Verify Flutter sees the device:

```bash
flutter devices
```

5. Run the app:

```bash
flutter run -d <your-device-id>
```

### Build a Release APK

```bash
flutter build apk --release
```

The APK is at `build/app/outputs/flutter-apk/app-release.apk`. Transfer it to the device and install it, or distribute it directly.

> **Sideloading:** To install the APK manually, enable **Install unknown apps** on the device under **Settings → Security**.

### Build an App Bundle (for Google Play)

```bash
flutter build appbundle --release
```

The AAB is at `build/app/outputs/bundle/release/app-release.aab`. Upload this to the Google Play Console.

### Configure a Release Signing Key

The current `build.gradle.kts` signs release builds with the debug key, which is not suitable for production. To add a proper signing key:

1. Generate a keystore:

```bash
keytool -genkey -v -keystore ~/linkdqueue-release.jks \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -alias linkdqueue
```

2. Create `android/key.properties` (do not commit this file):

```properties
storePassword=<your-store-password>
keyPassword=<your-key-password>
keyAlias=linkdqueue
storeFile=<absolute-path-to>/linkdqueue-release.jks
```

3. Update `android/app/build.gradle.kts` to load the signing config from `key.properties`.

---

## Shared Intent (Share to linkdqueue)

Both platforms support receiving URLs shared from other apps:

- **Android**: the app registers an `ACTION_SEND` intent filter for `text/plain` content.
- **iOS**: configure a Share Extension in Xcode if deep share-sheet integration is needed beyond what `receive_sharing_intent` provides out of the box.

---

## Useful Flutter Commands

| Command | Description |
|---|---|
| `flutter devices` | List connected devices and emulators |
| `flutter run` | Build and run a debug build |
| `flutter run --release` | Build and run a release build |
| `flutter build apk` | Build Android APK |
| `flutter build appbundle` | Build Android App Bundle |
| `flutter build ipa` | Build iOS IPA |
| `flutter clean` | Clear build cache |
| `flutter pub get` | Fetch/update dependencies |
