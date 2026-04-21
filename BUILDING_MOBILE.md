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

### Install on a Physical Device with an Apple Developer Account

You need an [Apple Developer account](https://developer.apple.com/programs/) (free or paid) to install on a real device.

#### Step 1 — Configure signing in Xcode

1. Open `ios/Runner.xcworkspace` in Xcode (not `Runner.xcodeproj`).
2. In the Project navigator, select **Runner** → **Runner** target → **Signing & Capabilities** tab.
3. Tick **Automatically manage signing**.
4. Choose your **Team** from the drop-down (sign in with your Apple ID under **Xcode → Settings → Accounts** if your team is not listed yet).
5. Set a unique **Bundle Identifier** — something like `com.yourname.linkdqueue`. It must be globally unique.

> **Free vs. paid account:** A free Apple ID lets you sideload onto up to 3 devices, but the certificate expires after 7 days (you must rebuild and reinstall weekly). A paid membership ($99/year) gives 90-day certificates and lets you distribute via TestFlight or the App Store.

#### Step 2 — Trust the developer certificate on your iPhone

The first time you install from a new developer account, iOS will block the app until you explicitly trust it:

1. On your iPhone, open **Settings → General → VPN & Device Management**.
2. Under **Developer App**, tap your Apple ID email address.
3. Tap **Trust "[your Apple ID]"** and confirm.

You only need to do this once per developer account per device.

#### Step 3 — Build and install

Connect your iPhone via USB, unlock it, and tap **Trust** on the "Trust This Computer?" prompt if it appears.

**Quickest option — build and install in one command:**

```bash
flutter devices          # confirm your iPhone is listed
flutter run --release -d <device-id>
```

Flutter builds, signs with your development certificate, and installs directly.

**IPA option — for sharing or keeping a build artifact:**

```bash
flutter build ipa --export-method development
```

> **Important:** Do not use `--export-method app-store`. That requires a paid Apple Developer membership ($99/year) and is only needed for App Store or TestFlight distribution. For personal sideloading, `development` is always the right choice.

This produces an IPA at `build/ios/ipa/linkdqueue.ipa`. Install it by:

1. Opening **Xcode → Window → Devices and Simulators**.
2. Selecting your iPhone in the left sidebar.
3. Clicking the **+** button under **Installed Apps** and choosing the IPA file.

**Alternatively, use Xcode directly:**

1. Select your connected iPhone as the run destination in the Xcode toolbar.
2. Choose **Product → Archive**.
3. In the Organizer window, select the archive and click **Distribute App**.
4. Choose **Development** (not App Store Connect) and follow the prompts.
5. Drag the exported IPA onto your device in the **Devices & Simulators** window.

#### App icon and launch image warnings

You may see warnings like:

```
App icon is set to the default placeholder icon.
Launch image is set to the default placeholder icon.
```

These are cosmetic reminders to replace Flutter's default assets before any public release. They will not block a development build or prevent installation on your own device.

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
