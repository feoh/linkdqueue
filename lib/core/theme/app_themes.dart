import 'package:flutter/material.dart';

// ---------------------------------------------------------------------------
// Theme catalogue
// ---------------------------------------------------------------------------

enum AppThemeOption {
  system('System default'),
  catppuccinMocha('Catppuccin Mocha'),
  catppuccinLatte('Catppuccin Latte'),
  dracula('Dracula'),
  tokyoNight('Tokyo Night'),
  tokyoDay('Tokyo Day'),
  gruvbox('Gruvbox'),
  oneDark('One Dark');

  final String label;
  const AppThemeOption(this.label);

  /// Whether this theme is inherently dark (used to force ThemeMode).
  bool get isDark => switch (this) {
        AppThemeOption.system => false, // handled separately
        AppThemeOption.catppuccinLatte => false,
        AppThemeOption.tokyoDay => false,
        _ => true,
      };

  /// Primary + surface swatch for the picker preview tile.
  (Color primary, Color surface) get swatch => switch (this) {
        AppThemeOption.system =>
          (const Color(0xFF4A90D9), const Color(0xFFFFFFFF)),
        AppThemeOption.catppuccinMocha =>
          (const Color(0xFFCBA6F7), const Color(0xFF1E1E2E)),
        AppThemeOption.catppuccinLatte =>
          (const Color(0xFF8839EF), const Color(0xFFEFF1F5)),
        AppThemeOption.dracula =>
          (const Color(0xFFBD93F9), const Color(0xFF282A36)),
        AppThemeOption.tokyoNight =>
          (const Color(0xFF7AA2F7), const Color(0xFF1A1B26)),
        AppThemeOption.tokyoDay =>
          (const Color(0xFF2E7DE9), const Color(0xFFE1E2E7)),
        AppThemeOption.gruvbox =>
          (const Color(0xFFD79921), const Color(0xFF282828)),
        AppThemeOption.oneDark =>
          (const Color(0xFF61AFEF), const Color(0xFF282C34)),
      };
}

// ---------------------------------------------------------------------------
// Builder helpers
// ---------------------------------------------------------------------------

class AppThemes {
  AppThemes._();

  static ThemeData build(AppThemeOption option) => switch (option) {
        AppThemeOption.system => _systemLight, // fallback; app.dart handles system
        AppThemeOption.catppuccinMocha => _catppuccinMocha,
        AppThemeOption.catppuccinLatte => _catppuccinLatte,
        AppThemeOption.dracula => _dracula,
        AppThemeOption.tokyoNight => _tokyoNight,
        AppThemeOption.tokyoDay => _tokyoDay,
        AppThemeOption.gruvbox => _gruvbox,
        AppThemeOption.oneDark => _oneDark,
      };

  static ThemeData get systemLight => _systemLight;
  static ThemeData get systemDark => _systemDark;

  // ---- private helpers ----

  static ThemeData _dark({
    required Color seed,
    required Color surface,
    required Color onSurface,
    Color? secondary,
    Color? tertiary,
  }) {
    var scheme = ColorScheme.fromSeed(
      seedColor: seed,
      brightness: Brightness.dark,
    ).copyWith(
      primary: seed,
      surface: surface,
      onSurface: onSurface,
      // Tonal surface layers derived from the base surface colour
      surfaceContainerLowest: Color.lerp(surface, Colors.black, 0.06)!,
      surfaceContainerLow: Color.lerp(surface, Colors.black, 0.03)!,
      surfaceContainer: Color.lerp(surface, Colors.white, 0.04)!,
      surfaceContainerHigh: Color.lerp(surface, Colors.white, 0.08)!,
      surfaceContainerHighest: Color.lerp(surface, Colors.white, 0.13)!,
    );
    if (secondary != null) scheme = scheme.copyWith(secondary: secondary);
    if (tertiary != null) scheme = scheme.copyWith(tertiary: tertiary);
    return ThemeData(useMaterial3: true, colorScheme: scheme);
  }

  static ThemeData _light({
    required Color seed,
    required Color surface,
    required Color onSurface,
    Color? secondary,
    Color? tertiary,
  }) {
    var scheme = ColorScheme.fromSeed(
      seedColor: seed,
      brightness: Brightness.light,
    ).copyWith(
      primary: seed,
      surface: surface,
      onSurface: onSurface,
      surfaceContainerLowest: Color.lerp(surface, Colors.white, 0.6)!,
      surfaceContainerLow: Color.lerp(surface, Colors.white, 0.3)!,
      surfaceContainer: Color.lerp(surface, Colors.black, 0.03)!,
      surfaceContainerHigh: Color.lerp(surface, Colors.black, 0.06)!,
      surfaceContainerHighest: Color.lerp(surface, Colors.black, 0.10)!,
    );
    if (secondary != null) scheme = scheme.copyWith(secondary: secondary);
    if (tertiary != null) scheme = scheme.copyWith(tertiary: tertiary);
    return ThemeData(useMaterial3: true, colorScheme: scheme);
  }

  // ---- system default ----

  static final _systemLight = ThemeData(
    colorSchemeSeed: const Color(0xFF4A90D9),
    brightness: Brightness.light,
    useMaterial3: true,
  );

  static final _systemDark = ThemeData(
    colorSchemeSeed: const Color(0xFF4A90D9),
    brightness: Brightness.dark,
    useMaterial3: true,
  );

  // ---- Catppuccin Mocha ----
  // https://github.com/catppuccin/catppuccin
  static final _catppuccinMocha = _dark(
    seed: const Color(0xFFCBA6F7),      // Mauve
    surface: const Color(0xFF1E1E2E),   // Base
    onSurface: const Color(0xFFCDD6F4), // Text
    secondary: const Color(0xFF89DCEB), // Sky
    tertiary: const Color(0xFFF38BA8),  // Red
  );

  // ---- Catppuccin Latte ----
  static final _catppuccinLatte = _light(
    seed: const Color(0xFF8839EF),      // Mauve
    surface: const Color(0xFFEFF1F5),   // Base
    onSurface: const Color(0xFF4C4F69), // Text
    secondary: const Color(0xFF04A5E5), // Sky
    tertiary: const Color(0xFFD20F39),  // Red
  );

  // ---- Dracula ----
  // https://draculatheme.com/contribute
  static final _dracula = _dark(
    seed: const Color(0xFFBD93F9),      // Purple
    surface: const Color(0xFF282A36),   // Background
    onSurface: const Color(0xFFF8F8F2), // Foreground
    secondary: const Color(0xFFFF79C6), // Pink
    tertiary: const Color(0xFF50FA7B),  // Green
  );

  // ---- Tokyo Night ----
  // https://github.com/folke/tokyonight.nvim
  static final _tokyoNight = _dark(
    seed: const Color(0xFF7AA2F7),      // Blue
    surface: const Color(0xFF1A1B26),   // Background
    onSurface: const Color(0xFFC0CAF5), // Foreground
    secondary: const Color(0xFFBB9AF7), // Purple
    tertiary: const Color(0xFF9ECE6A),  // Green
  );

  // ---- Tokyo Day ----
  static final _tokyoDay = _light(
    seed: const Color(0xFF2E7DE9),      // Blue
    surface: const Color(0xFFE1E2E7),   // Background
    onSurface: const Color(0xFF3760BF), // Foreground
    secondary: const Color(0xFF9854F1), // Purple
    tertiary: const Color(0xFF587539),  // Green
  );

  // ---- Gruvbox ----
  // https://github.com/morhetz/gruvbox
  static final _gruvbox = _dark(
    seed: const Color(0xFFD79921),      // Yellow (bright)
    surface: const Color(0xFF282828),   // Background hard
    onSurface: const Color(0xFFEBDBB2), // Foreground
    secondary: const Color(0xFF98971A), // Green
    tertiary: const Color(0xFFCC241D),  // Red
  );

  // ---- One Dark ----
  // https://github.com/atom/atom/tree/master/packages/one-dark-ui
  static final _oneDark = _dark(
    seed: const Color(0xFF61AFEF),      // Blue
    surface: const Color(0xFF282C34),   // Background
    onSurface: const Color(0xFFABB2BF), // Foreground
    secondary: const Color(0xFFC678DD), // Purple
    tertiary: const Color(0xFF98C379),  // Green
  );
}
