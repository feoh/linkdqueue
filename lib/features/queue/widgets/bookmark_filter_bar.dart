import 'package:flutter/material.dart';

class BookmarkFilterBar extends StatefulWidget {
  final List<String> availableTags;
  final String? selectedTag;
  final String searchQuery;
  final ValueChanged<String> onQueryChanged;
  final ValueChanged<String?> onTagChanged;

  const BookmarkFilterBar({
    super.key,
    required this.availableTags,
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

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
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
        if (widget.availableTags.isNotEmpty) ...[
          const SizedBox(height: 8),
          SizedBox(
            height: 40,
            child: ListView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 16),
              children: [
                FilterChip(
                  label: const Text('All'),
                  selected: widget.selectedTag == null,
                  onSelected: (_) => widget.onTagChanged(null),
                ),
                const SizedBox(width: 8),
                ...widget.availableTags.map(
                  (tag) => Padding(
                    padding: const EdgeInsets.only(right: 8),
                    child: FilterChip(
                      label: Text(tag),
                      selected: widget.selectedTag == tag,
                      onSelected: (selected) =>
                          widget.onTagChanged(selected ? tag : null),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
        const SizedBox(height: 8),
      ],
    );
  }
}
