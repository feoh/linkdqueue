import 'package:riverpod_annotation/riverpod_annotation.dart';

import '../../core/models/tag.dart';
import '../../core/providers/api_client_provider.dart';
import '../../core/providers/settings_provider.dart';

part 'tags_notifier.g.dart';

@riverpod
class TagsNotifier extends _$TagsNotifier {
  @override
  Future<List<Tag>> build() async {
    return _fetchAll();
  }

  Future<List<Tag>> _fetchAll() async {
    final settings = ref.read(settingsNotifierProvider).valueOrNull;
    if (settings == null || !settings.isConfigured) return [];
    final client = ref.read(apiClientProvider);
    const limit = 100;
    int offset = 0;
    final all = <Tag>[];

    while (true) {
      final page = await client.getTags(limit: limit, offset: offset);
      all.addAll(page.results);
      if (all.length >= page.count || page.next == null) break;
      offset += limit;
    }
    all.sort((a, b) => a.name.toLowerCase().compareTo(b.name.toLowerCase()));
    return all;
  }

  Future<void> refresh() async {
    state = const AsyncLoading();
    state = await AsyncValue.guard(_fetchAll);
  }
}
