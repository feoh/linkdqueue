import 'package:flutter/material.dart';
import 'package:flutter_slidable/flutter_slidable.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../core/models/bookmark.dart';

class BookmarkListTile extends StatelessWidget {
  final Bookmark bookmark;
  final VoidCallback? onMarkRead;
  final VoidCallback? onArchive;
  final VoidCallback? onDelete;

  const BookmarkListTile({
    super.key,
    required this.bookmark,
    this.onMarkRead,
    this.onArchive,
    this.onDelete,
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
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                bookmark.displayTitle,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: Theme.of(context).textTheme.titleSmall?.copyWith(
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
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color:
                            Theme.of(context).colorScheme.onSurfaceVariant,
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
                        (tag) => Chip(
                          label: Text(tag),
                          labelStyle: const TextStyle(fontSize: 11),
                          padding: EdgeInsets.zero,
                          materialTapTargetSize:
                              MaterialTapTargetSize.shrinkWrap,
                          visualDensity: VisualDensity.compact,
                        ),
                      )
                      .toList(),
                ),
              ],
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
