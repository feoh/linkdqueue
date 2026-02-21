import 'package:json_annotation/json_annotation.dart';

part 'bookmark.g.dart';

@JsonSerializable()
class Bookmark {
  final int id;
  final String url;

  @JsonKey(defaultValue: '')
  final String title;

  @JsonKey(name: 'website_title')
  final String? websiteTitle;

  @JsonKey(name: 'website_description')
  final String? websiteDescription;

  @JsonKey(defaultValue: '')
  final String description;

  @JsonKey(name: 'tag_names', defaultValue: [])
  final List<String> tagNames;

  @JsonKey(name: 'is_archived', defaultValue: false)
  final bool isArchived;

  @JsonKey(name: 'is_read', defaultValue: false)
  final bool isRead;

  @JsonKey(name: 'date_added')
  final DateTime dateAdded;

  const Bookmark({
    required this.id,
    required this.url,
    required this.title,
    this.websiteTitle,
    this.websiteDescription,
    required this.description,
    required this.tagNames,
    required this.isArchived,
    required this.isRead,
    required this.dateAdded,
  });

  String get displayTitle =>
      title.isNotEmpty ? title : (websiteTitle ?? url);

  String get displayDescription =>
      description.isNotEmpty ? description : (websiteDescription ?? '');

  factory Bookmark.fromJson(Map<String, dynamic> json) =>
      _$BookmarkFromJson(json);

  Map<String, dynamic> toJson() => _$BookmarkToJson(this);

  Bookmark copyWith({
    int? id,
    String? url,
    String? title,
    String? websiteTitle,
    String? websiteDescription,
    String? description,
    List<String>? tagNames,
    bool? isArchived,
    bool? isRead,
    DateTime? dateAdded,
  }) {
    return Bookmark(
      id: id ?? this.id,
      url: url ?? this.url,
      title: title ?? this.title,
      websiteTitle: websiteTitle ?? this.websiteTitle,
      websiteDescription: websiteDescription ?? this.websiteDescription,
      description: description ?? this.description,
      tagNames: tagNames ?? this.tagNames,
      isArchived: isArchived ?? this.isArchived,
      isRead: isRead ?? this.isRead,
      dateAdded: dateAdded ?? this.dateAdded,
    );
  }
}
