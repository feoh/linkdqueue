import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/providers/settings_provider.dart';
import 'settings_notifier.dart';

class SettingsScreen extends ConsumerStatefulWidget {
  const SettingsScreen({super.key});

  @override
  ConsumerState<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends ConsumerState<SettingsScreen> {
  final _formKey = GlobalKey<FormState>();
  final _urlController = TextEditingController();
  final _tokenController = TextEditingController();
  bool _obscureToken = true;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    final settings = ref.read(settingsNotifierProvider).valueOrNull;
    if (settings != null) {
      _urlController.text = settings.baseUrl ?? '';
      _tokenController.text = settings.apiToken ?? '';
    }
  }

  @override
  void dispose() {
    _urlController.dispose();
    _tokenController.dispose();
    super.dispose();
  }

  Future<void> _testConnection() async {
    if (!_formKey.currentState!.validate()) return;
    await ref.read(connectionTesterProvider.notifier).test(
          baseUrl: _urlController.text.trim(),
          token: _tokenController.text.trim(),
        );
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _saving = true);
    try {
      await ref.read(settingsNotifierProvider.notifier).saveSettings(
            baseUrl: _urlController.text.trim(),
            token: _tokenController.text.trim(),
          );
      if (mounted) context.go('/queue');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final testResult = ref.watch(connectionTesterProvider);
    final currentSettings = ref.watch(settingsNotifierProvider).valueOrNull;
    final isConfigured = currentSettings?.isConfigured ?? false;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Settings'),
        leading: isConfigured
            ? IconButton(
                icon: const Icon(Icons.arrow_back),
                onPressed: () => context.go('/queue'),
              )
            : null,
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: Form(
          key: _formKey,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                'Linkding Connection',
                style: Theme.of(context).textTheme.headlineSmall,
              ),
              const SizedBox(height: 8),
              Text(
                'Enter your Linkding instance URL and API token.',
                style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                      color: Theme.of(context).colorScheme.onSurfaceVariant,
                    ),
              ),
              const SizedBox(height: 24),
              TextFormField(
                controller: _urlController,
                decoration: const InputDecoration(
                  labelText: 'Linkding URL',
                  hintText: 'https://linkding.example.com',
                  border: OutlineInputBorder(),
                  prefixIcon: Icon(Icons.link),
                ),
                keyboardType: TextInputType.url,
                autocorrect: false,
                onChanged: (_) =>
                    ref.read(connectionTesterProvider.notifier).reset(),
                validator: (v) {
                  if (v == null || v.trim().isEmpty) {
                    return 'URL is required';
                  }
                  final uri = Uri.tryParse(v.trim());
                  if (uri == null ||
                      !uri.hasScheme ||
                      !uri.host.isNotEmpty) {
                    return 'Enter a valid URL';
                  }
                  return null;
                },
              ),
              const SizedBox(height: 16),
              TextFormField(
                controller: _tokenController,
                obscureText: _obscureToken,
                decoration: InputDecoration(
                  labelText: 'API Token',
                  hintText: 'Your Linkding API token',
                  border: const OutlineInputBorder(),
                  prefixIcon: const Icon(Icons.key),
                  suffixIcon: IconButton(
                    icon: Icon(
                      _obscureToken
                          ? Icons.visibility_outlined
                          : Icons.visibility_off_outlined,
                    ),
                    onPressed: () =>
                        setState(() => _obscureToken = !_obscureToken),
                  ),
                ),
                autocorrect: false,
                onChanged: (_) =>
                    ref.read(connectionTesterProvider.notifier).reset(),
                validator: (v) {
                  if (v == null || v.trim().isEmpty) {
                    return 'API token is required';
                  }
                  return null;
                },
              ),
              const SizedBox(height: 8),
              Text(
                'Find your API token in Linkding → Settings → Integrations.',
                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                      color: Theme.of(context).colorScheme.onSurfaceVariant,
                    ),
              ),
              const SizedBox(height: 24),
              // Connection test result
              if (testResult.state == ConnectionTestState.success)
                _StatusBanner(
                  icon: Icons.check_circle_outline,
                  message: 'Connection successful!',
                  color: Colors.green,
                ),
              if (testResult.state == ConnectionTestState.failure)
                _StatusBanner(
                  icon: Icons.error_outline,
                  message: testResult.errorMessage ?? 'Connection failed',
                  color: Theme.of(context).colorScheme.error,
                ),
              if (testResult.state == ConnectionTestState.success ||
                  testResult.state == ConnectionTestState.failure)
                const SizedBox(height: 16),
              OutlinedButton.icon(
                onPressed: testResult.state == ConnectionTestState.loading
                    ? null
                    : _testConnection,
                icon: testResult.state == ConnectionTestState.loading
                    ? const SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.wifi_tethering),
                label: const Text('Test Connection'),
              ),
              const SizedBox(height: 12),
              FilledButton.icon(
                onPressed: _saving ? null : _save,
                icon: _saving
                    ? const SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: Colors.white,
                        ),
                      )
                    : const Icon(Icons.save_outlined),
                label: const Text('Save'),
              ),
              const SizedBox(height: 32),
              const Divider(),
              const SizedBox(height: 16),
              Text(
                'Display',
                style: Theme.of(context).textTheme.headlineSmall,
              ),
              const SizedBox(height: 16),
              _FontSizeControl(),
              if (isConfigured) ...[
                const SizedBox(height: 12),
                TextButton.icon(
                  onPressed: () async {
                    final confirm = await showDialog<bool>(
                      context: context,
                      builder: (ctx) => AlertDialog(
                        title: const Text('Clear settings?'),
                        content: const Text(
                          'This will remove your Linkding URL and API token from this device.',
                        ),
                        actions: [
                          TextButton(
                            onPressed: () => Navigator.pop(ctx, false),
                            child: const Text('Cancel'),
                          ),
                          FilledButton(
                            onPressed: () => Navigator.pop(ctx, true),
                            child: const Text('Clear'),
                          ),
                        ],
                      ),
                    );
                    if (confirm == true && mounted) {
                      await ref
                          .read(settingsNotifierProvider.notifier)
                          .clearSettings();
                    }
                  },
                  icon: const Icon(Icons.delete_outline),
                  label: const Text('Clear saved settings'),
                  style: TextButton.styleFrom(
                    foregroundColor: Theme.of(context).colorScheme.error,
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class _FontSizeControl extends ConsumerWidget {
  static const _steps = [
    (scale: 0.85, label: 'XS'),
    (scale: 1.0,  label: 'S'),
    (scale: 1.25, label: 'M'),
    (scale: 1.5,  label: 'L'),
    (scale: 1.75, label: 'XL'),
    (scale: 2.0,  label: 'XXL'),
  ];

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final current =
        ref.watch(settingsNotifierProvider).valueOrNull?.textScale ?? 1.0;

    // Snap to nearest step index for the slider
    int nearestIndex = 0;
    double minDiff = double.infinity;
    for (var i = 0; i < _steps.length; i++) {
      final diff = (_steps[i].scale - current).abs();
      if (diff < minDiff) {
        minDiff = diff;
        nearestIndex = i;
      }
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(
              'Text size',
              style: Theme.of(context).textTheme.titleMedium,
            ),
            Text(
              _steps[nearestIndex].label,
              style: Theme.of(context).textTheme.titleMedium?.copyWith(
                    color: Theme.of(context).colorScheme.primary,
                    fontWeight: FontWeight.bold,
                  ),
            ),
          ],
        ),
        const SizedBox(height: 4),
        // Live preview sentence
        Container(
          width: double.infinity,
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          decoration: BoxDecoration(
            color: Theme.of(context).colorScheme.surfaceContainerHighest,
            borderRadius: BorderRadius.circular(8),
          ),
          child: Text(
            'The quick brown fox jumps over the lazy dog.',
            style: Theme.of(context).textTheme.bodyMedium,
            // textScaler is inherited from MediaQuery, so this previews live
          ),
        ),
        Slider(
          value: nearestIndex.toDouble(),
          min: 0,
          max: (_steps.length - 1).toDouble(),
          divisions: _steps.length - 1,
          label: _steps[nearestIndex].label,
          onChanged: (v) {
            final idx = v.round();
            ref
                .read(settingsNotifierProvider.notifier)
                .setTextScale(_steps[idx].scale);
          },
        ),
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: _steps
              .map((s) => Text(
                    s.label,
                    style: Theme.of(context).textTheme.labelSmall?.copyWith(
                          color:
                              Theme.of(context).colorScheme.onSurfaceVariant,
                        ),
                  ))
              .toList(),
        ),
      ],
    );
  }
}

class _StatusBanner extends StatelessWidget {
  final IconData icon;
  final String message;
  final Color color;

  const _StatusBanner({
    required this.icon,
    required this.message,
    required this.color,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: color.withValues(alpha: 0.4)),
      ),
      child: Row(
        children: [
          Icon(icon, color: color, size: 20),
          const SizedBox(width: 12),
          Expanded(
            child: Text(
              message,
              style: TextStyle(color: color),
            ),
          ),
        ],
      ),
    );
  }
}
