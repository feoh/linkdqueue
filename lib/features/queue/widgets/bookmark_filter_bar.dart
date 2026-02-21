import 'package:flutter/material.dart';

class BookmarkFilterBar extends StatefulWidget {
  final List<String> availableTags;
  final bool tagsLoading;
  final String? selectedTag;
  final String searchQuery;
  final ValueChanged<String> onQueryChanged;
  final ValueChanged<String?> onTagChanged;

  const BookmarkFilterBar({
    super.key,
    required this.availableTags,
    this.tagsLoading = false,
    this.selectedTag,
    required this.searchQuery,
    required this.onQueryChanged,
    required this.onTagChanged,
  });

  @override
  State<BookmarkFilterBar> createState() => _BookmarkFilterBarState();
}

class _BookmarkFilterBarState extends State<BookmarkFilterBar> {
  late final TextEditingController _controller;

  @override
  void initState() {
    super.initState();
    _controller = TextEditingController(text: widget.searchQuery);
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _openTagPicker() async {
    final picked = await showModalBottomSheet<String?>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (_) => _TagPickerSheet(
        tags: widget.availableTags,
        selectedTag: widget.selectedTag,
      ),
    );
    // null means the sheet was dismissed without selection; _kClear is the
    // sentinel value meaning the user explicitly cleared the filter.
    if (picked == _kClear) {
      widget.onTagChanged(null);
    } else if (picked != null) {
      widget.onTagChanged(picked);
    }
  }

  @override
  Widget build(BuildContext context) {
    final hasTag = widget.selectedTag != null;

    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
      child: Row(
        children: [
          // ── full-text search bar ──────────────────────────────────────
          Expanded(
            child: SearchBar(
              controller: _controller,
              hintText: 'Search bookmarks…',
              leading: const Icon(Icons.search),
              trailing: [
                if (_controller.text.isNotEmpty)
                  IconButton(
                    icon: const Icon(Icons.close),
                    onPressed: () {
                      _controller.clear();
                      widget.onQueryChanged('');
                    },
                  ),
              ],
              onChanged: widget.onQueryChanged,
            ),
          ),
          const SizedBox(width: 8),
          // ── tag picker button ─────────────────────────────────────────
          if (hasTag)
            InputChip(
              avatar: const Icon(Icons.label, size: 16),
              label: Text(
                widget.selectedTag!,
                overflow: TextOverflow.ellipsis,
              ),
              onPressed: _openTagPicker,
              onDeleted: () => widget.onTagChanged(null),
              deleteIconColor:
                  Theme.of(context).colorScheme.onPrimary,
              backgroundColor:
                  Theme.of(context).colorScheme.primary,
              labelStyle: TextStyle(
                color: Theme.of(context).colorScheme.onPrimary,
              ),
            )
          else if (widget.tagsLoading)
            Tooltip(
              message: 'Loading tags…',
              child: SizedBox.square(
                dimension: 40,
                child: Center(
                  child: SizedBox.square(
                    dimension: 20,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  ),
                ),
              ),
            )
          else
            IconButton.outlined(
              icon: const Icon(Icons.label_outline),
              tooltip: 'Filter by tag',
              onPressed: _openTagPicker,
            ),
        ],
      ),
    );
  }
}

// Sentinel returned when the user taps "Clear filter" in the sheet.
const _kClear = '\x00clear';

// ---------------------------------------------------------------------------
// Bottom sheet
// ---------------------------------------------------------------------------

class _TagPickerSheet extends StatefulWidget {
  final List<String> tags;
  final String? selectedTag;

  const _TagPickerSheet({required this.tags, this.selectedTag});

  @override
  State<_TagPickerSheet> createState() => _TagPickerSheetState();
}

class _TagPickerSheetState extends State<_TagPickerSheet> {
  final _searchController = TextEditingController();
  final _focusNode = FocusNode();
  late List<String> _filtered;

  @override
  void initState() {
    super.initState();
    _filtered = widget.tags;
    _searchController.addListener(_onSearch);
    // Request focus after the first frame so the sheet is fully laid out
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
          ? widget.tags
          : widget.tags
              .where((t) => t.toLowerCase().contains(q))
              .toList();
    });
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
          // ── drag handle ───────────────────────────────────────────────
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
          // ── header ────────────────────────────────────────────────────
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Row(
              children: [
                Text('Filter by tag',
                    style: Theme.of(context).textTheme.titleLarge),
                const Spacer(),
                if (widget.selectedTag != null)
                  TextButton.icon(
                    icon: const Icon(Icons.close, size: 16),
                    label: const Text('Clear'),
                    onPressed: () => Navigator.pop(context, _kClear),
                  ),
              ],
            ),
          ),
          const SizedBox(height: 8),
          // ── search field ──────────────────────────────────────────────
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
          // ── tag list ──────────────────────────────────────────────────
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
                      final isSelected = tag == widget.selectedTag;
                      return ListTile(
                        leading: Icon(
                          isSelected
                              ? Icons.label
                              : Icons.label_outline,
                          color: isSelected ? scheme.primary : null,
                        ),
                        title: Text(tag),
                        trailing: isSelected
                            ? Icon(Icons.check, color: scheme.primary)
                            : null,
                        selected: isSelected,
                        onTap: () => Navigator.pop(context, tag),
                      );
                    },
                  ),
          ),
        ],
      ),
    );
  }
}
