import 'package:flutter/material.dart';
import 'package:flutter_slidable/flutter_slidable.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../core/models/bookmark.dart';

class BookmarkListTile extends StatelessWidget {
  final Bookmark bookmark;
  final VoidCallback? onMarkRead;
  final VoidCallback? onArchive;
  final VoidCallback? onDelete;
  final VoidCallback? onEditTags;
  final ValueChanged<String>? onTagTapped;
  final String? selectedTag;

  const BookmarkListTile({
    super.key,
    required this.bookmark,
    this.onMarkRead,
    this.onArchive,
    this.onDelete,
    this.onEditTags,
    this.onTagTapped,
    this.selectedTag,
  });

  Future<void> _openUrl(BuildContext context) async {
    final uri = Uri.tryParse(bookmark.url);
    if (uri == null) return;
    if (!await launchUrl(uri, mode: LaunchMode.externalApplication)) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Could not open ${bookmark.url}')),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Slidable(
      key: ValueKey(bookmark.id),
      startActionPane: ActionPane(
        motion: const DrawerMotion(),
        extentRatio: 0.25,
        children: [
          SlidableAction(
            onPressed: (_) => onMarkRead?.call(),
            backgroundColor: Colors.green,
            foregroundColor: Colors.white,
            icon: Icons.done,
            label: 'Read',
            borderRadius: const BorderRadius.only(
              topLeft: Radius.circular(8),
              bottomLeft: Radius.circular(8),
            ),
          ),
        ],
      ),
      endActionPane: ActionPane(
        motion: const DrawerMotion(),
        children: [
          SlidableAction(
            onPressed: (_) => onArchive?.call(),
            backgroundColor: Colors.blueGrey,
            foregroundColor: Colors.white,
            icon: Icons.archive_outlined,
            label: 'Archive',
          ),
          SlidableAction(
            onPressed: (_) => onDelete?.call(),
            backgroundColor: Theme.of(context).colorScheme.error,
            foregroundColor: Colors.white,
            icon: Icons.delete_outline,
            label: 'Delete',
            borderRadius: const BorderRadius.only(
              topRight: Radius.circular(8),
              bottomRight: Radius.circular(8),
            ),
          ),
        ],
      ),
      child: InkWell(
        onTap: () => _openUrl(context),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 4, 12),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      bookmark.displayTitle,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style:
                          Theme.of(context).textTheme.titleSmall?.copyWith(
                                fontWeight: FontWeight.w600,
                              ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      _hostname(bookmark.url),
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                            color: Theme.of(context).colorScheme.primary,
                          ),
                    ),
                    if (bookmark.displayDescription.isNotEmpty) ...[
                      const SizedBox(height: 4),
                      Text(
                        bookmark.displayDescription,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style:
                            Theme.of(context).textTheme.bodySmall?.copyWith(
                                  color: Theme.of(context)
                                      .colorScheme
                                      .onSurfaceVariant,
                                ),
                      ),
                    ],
                    if (bookmark.tagNames.isNotEmpty) ...[
                      const SizedBox(height: 8),
                      Wrap(
                        spacing: 4,
                        runSpacing: 4,
                        children: bookmark.tagNames
                            .map(
                              (tag) => ActionChip(
                                label: Text(tag),
                                labelStyle: TextStyle(
                                  fontSize: 11,
                                  color: tag == selectedTag
                                      ? Theme.of(context)
                                          .colorScheme
                                          .onPrimary
                                      : null,
                                ),
                                backgroundColor: tag == selectedTag
                                    ? Theme.of(context).colorScheme.primary
                                    : null,
                                padding: EdgeInsets.zero,
                                materialTapTargetSize:
                                    MaterialTapTargetSize.shrinkWrap,
                                visualDensity: VisualDensity.compact,
                                onPressed: () => onTagTapped?.call(tag),
                              ),
                            )
                            .toList(),
                      ),
                    ],
                  ],
                ),
              ),
              // ── actions menu ──────────────────────────────────────────
              PopupMenuButton<_TileAction>(
                icon: const Icon(Icons.more_vert),
                tooltip: 'Actions',
                onSelected: (action) {
                  switch (action) {
                    case _TileAction.markRead:
                      onMarkRead?.call();
                    case _TileAction.editTags:
                      onEditTags?.call();
                    case _TileAction.archive:
                      onArchive?.call();
                    case _TileAction.delete:
                      onDelete?.call();
                  }
                },
                itemBuilder: (_) => const [
                  PopupMenuItem(
                    value: _TileAction.markRead,
                    child: ListTile(
                      leading: Icon(Icons.done),
                      title: Text('Mark as read'),
                      contentPadding: EdgeInsets.zero,
                    ),
                  ),
                  PopupMenuItem(
                    value: _TileAction.editTags,
                    child: ListTile(
                      leading: Icon(Icons.label_outline),
                      title: Text('Edit tags'),
                      contentPadding: EdgeInsets.zero,
                    ),
                  ),
                  PopupMenuDivider(),
                  PopupMenuItem(
                    value: _TileAction.archive,
                    child: ListTile(
                      leading: Icon(Icons.archive_outlined),
                      title: Text('Archive'),
                      contentPadding: EdgeInsets.zero,
                    ),
                  ),
                  PopupMenuItem(
                    value: _TileAction.delete,
                    child: ListTile(
                      leading: Icon(Icons.delete_outline),
                      title: Text('Delete'),
                      contentPadding: EdgeInsets.zero,
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  String _hostname(String url) {
    try {
      return Uri.parse(url).host;
    } catch (_) {
      return url;
    }
  }
}

enum _TileAction { markRead, editTags, archive, delete }
