import 'package:flutter/material.dart';

import '../../../core/models/bookmark.dart';

class TagEditorSheet extends StatefulWidget {
  final Bookmark bookmark;
  final List<String> availableTags;
  final Future<void> Function(List<String> tagNames) onSave;

  const TagEditorSheet({
    super.key,
    required this.bookmark,
    required this.availableTags,
    required this.onSave,
  });

  @override
  State<TagEditorSheet> createState() => _TagEditorSheetState();
}

class _TagEditorSheetState extends State<TagEditorSheet> {
  late Set<String> _selected;
  final _searchController = TextEditingController();
  final _focusNode = FocusNode();
  late List<String> _filtered;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    _selected = Set.of(widget.bookmark.tagNames);
    _filtered = widget.availableTags;
    _searchController.addListener(_onSearch);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _focusNode.requestFocus();
    });
  }

  @override
  void dispose() {
    _searchController.dispose();
    _focusNode.dispose();
    super.dispose();
  }

  void _onSearch() {
    final q = _searchController.text.toLowerCase();
    setState(() {
      _filtered = q.isEmpty
          ? widget.availableTags
          : widget.availableTags
              .where((t) => t.toLowerCase().contains(q))
              .toList();
    });
  }

  Future<void> _save() async {
    setState(() => _saving = true);
    await widget.onSave(_selected.toList());
    if (mounted) Navigator.pop(context);
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    return DraggableScrollableSheet(
      initialChildSize: 0.6,
      minChildSize: 0.4,
      maxChildSize: 0.92,
      expand: false,
      builder: (context, scrollController) => Column(
        children: [
          // ── drag handle ─────────────────────────────────────────────────
          const SizedBox(height: 8),
          Container(
            width: 36,
            height: 4,
            decoration: BoxDecoration(
              color: scheme.onSurfaceVariant.withValues(alpha: 0.4),
              borderRadius: BorderRadius.circular(2),
            ),
          ),
          const SizedBox(height: 12),
          // ── header ──────────────────────────────────────────────────────
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    'Edit tags',
                    style: Theme.of(context).textTheme.titleLarge,
                  ),
                ),
                FilledButton(
                  onPressed: _saving ? null : _save,
                  child: _saving
                      ? const SizedBox.square(
                          dimension: 16,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: Colors.white,
                          ),
                        )
                      : const Text('Save'),
                ),
              ],
            ),
          ),
          const SizedBox(height: 8),
          // ── search field ────────────────────────────────────────────────
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: TextField(
              controller: _searchController,
              focusNode: _focusNode,
              autofocus: true,
              decoration: InputDecoration(
                hintText: 'Search tags…',
                prefixIcon: const Icon(Icons.search),
                suffixIcon: _searchController.text.isNotEmpty
                    ? IconButton(
                        icon: const Icon(Icons.close),
                        onPressed: () => _searchController.clear(),
                      )
                    : null,
                border: const OutlineInputBorder(),
                isDense: true,
              ),
            ),
          ),
          const SizedBox(height: 8),
          const Divider(height: 1),
          // ── tag list ────────────────────────────────────────────────────
          Expanded(
            child: _filtered.isEmpty
                ? Center(
                    child: Text(
                      'No tags match "${_searchController.text}"',
                      style: TextStyle(color: scheme.onSurfaceVariant),
                    ),
                  )
                : ListView.builder(
                    controller: scrollController,
                    itemCount: _filtered.length,
                    itemBuilder: (context, index) {
                      final tag = _filtered[index];
                      final checked = _selected.contains(tag);
                      return CheckboxListTile(
                        value: checked,
                        title: Text(tag),
                        secondary: Icon(
                          checked ? Icons.label : Icons.label_outline,
                          color: checked ? scheme.primary : null,
                        ),
                        controlAffinity: ListTileControlAffinity.trailing,
                        onChanged: (_) => setState(() {
                          if (checked) {
                            _selected.remove(tag);
                          } else {
                            _selected.add(tag);
                          }
                        }),
                      );
                    },
                  ),
          ),
        ],
      ),
    );
  }
}
