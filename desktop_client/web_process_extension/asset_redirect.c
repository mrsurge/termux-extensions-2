#include <glib.h>
#include <glib-object.h>
#include <string.h>
#include <webkit/webkit-web-process-extension.h>

typedef struct {
    gchar *kind;
    gchar *source;
    gchar *destination;
} PathMapping;

typedef struct {
    gchar *asset_base_url;
    gchar *marker_path;
    gchar **prefixes;
    gchar **files;
    PathMapping *mappings;
    gsize mapping_count;
} RedirectConfig;

static RedirectConfig config = {0};

static gchar **copy_string_array(GVariant *array)
{
    const gsize count = g_variant_n_children(array);
    gchar **values = g_new0(gchar *, count + 1);
    for (gsize index = 0; index < count; ++index) {
        GVariant *child = g_variant_get_child_value(array, index);
        values[index] = g_variant_dup_string(child, NULL);
        g_variant_unref(child);
    }
    return values;
}

static gboolean string_array_contains(gchar **values, const gchar *candidate)
{
    if (values == NULL || candidate == NULL)
        return FALSE;
    for (gsize index = 0; values[index] != NULL; ++index) {
        if (g_str_equal(values[index], candidate))
            return TRUE;
    }
    return FALSE;
}

static gboolean string_array_has_prefix(gchar **values, const gchar *candidate)
{
    if (values == NULL || candidate == NULL)
        return FALSE;
    for (gsize index = 0; values[index] != NULL; ++index) {
        if (g_str_has_prefix(candidate, values[index]))
            return TRUE;
    }
    return FALSE;
}

static gchar *map_path(const gchar *path)
{
    for (gsize index = 0; index < config.mapping_count; ++index) {
        PathMapping *mapping = &config.mappings[index];
        if (g_str_equal(mapping->kind, "exact") &&
            g_str_equal(path, mapping->source)) {
            return g_strdup(mapping->destination);
        }
        if (g_str_equal(mapping->kind, "prefix") &&
            g_str_has_prefix(path, mapping->source)) {
            return g_strconcat(
                mapping->destination,
                path + strlen(mapping->source),
                NULL
            );
        }
    }
    return g_strdup(path);
}

static gboolean send_request(
    WebKitWebPage *page,
    WebKitURIRequest *request,
    WebKitURIResponse *redirected_response,
    gpointer user_data
)
{
    (void)page;
    (void)redirected_response;
    (void)user_data;

    if (config.asset_base_url == NULL || config.marker_path == NULL ||
        !g_file_test(config.marker_path, G_FILE_TEST_IS_REGULAR)) {
        return FALSE;
    }

    const gchar *uri = webkit_uri_request_get_uri(request);
    if (uri == NULL || g_str_has_prefix(uri, config.asset_base_url))
        return FALSE;

    GError *error = NULL;
    GUri *parsed = g_uri_parse(uri, G_URI_FLAGS_PARSE_RELAXED, &error);
    if (parsed == NULL) {
        g_clear_error(&error);
        return FALSE;
    }

    const gchar *scheme = g_uri_get_scheme(parsed);
    if (scheme == NULL ||
        (g_ascii_strcasecmp(scheme, "http") != 0 &&
         g_ascii_strcasecmp(scheme, "https") != 0)) {
        g_uri_unref(parsed);
        return FALSE;
    }

    const gchar *path = g_uri_get_path(parsed);
    const gboolean is_local = string_array_contains(config.files, path) ||
        string_array_has_prefix(config.prefixes, path);
    if (!is_local) {
        g_uri_unref(parsed);
        return FALSE;
    }

    gchar *mapped_path = map_path(path);
    const gchar *query = g_uri_get_query(parsed);
    gchar *local_uri = query == NULL
        ? g_strconcat(config.asset_base_url, mapped_path, NULL)
        : g_strconcat(config.asset_base_url, mapped_path, "?", query, NULL);
    webkit_uri_request_set_uri(request, local_uri);

    g_free(local_uri);
    g_free(mapped_path);
    g_uri_unref(parsed);
    return FALSE;
}

static void page_created(
    WebKitWebProcessExtension *extension,
    WebKitWebPage *page,
    gpointer user_data
)
{
    (void)extension;
    (void)user_data;
    g_signal_connect(page, "send-request", G_CALLBACK(send_request), NULL);
}

G_MODULE_EXPORT void webkit_web_process_extension_initialize_with_user_data(
    WebKitWebProcessExtension *extension,
    const GVariant *user_data
)
{
    GVariant *mutable_user_data = (GVariant *)user_data;
    if (user_data == NULL ||
        !g_variant_is_of_type(
            mutable_user_data,
            G_VARIANT_TYPE("(ssasasa(sss))")
        )) {
        return;
    }

    GVariant *asset_base = g_variant_get_child_value(mutable_user_data, 0);
    GVariant *marker = g_variant_get_child_value(mutable_user_data, 1);
    GVariant *prefixes = g_variant_get_child_value(mutable_user_data, 2);
    GVariant *files = g_variant_get_child_value(mutable_user_data, 3);
    GVariant *mappings = g_variant_get_child_value(mutable_user_data, 4);

    config.asset_base_url = g_variant_dup_string(asset_base, NULL);
    config.marker_path = g_variant_dup_string(marker, NULL);
    config.prefixes = copy_string_array(prefixes);
    config.files = copy_string_array(files);
    config.mapping_count = g_variant_n_children(mappings);
    config.mappings = g_new0(PathMapping, config.mapping_count);

    for (gsize index = 0; index < config.mapping_count; ++index) {
        GVariant *mapping = g_variant_get_child_value(mappings, index);
        GVariant *kind = g_variant_get_child_value(mapping, 0);
        GVariant *source = g_variant_get_child_value(mapping, 1);
        GVariant *destination = g_variant_get_child_value(mapping, 2);
        config.mappings[index].kind = g_variant_dup_string(kind, NULL);
        config.mappings[index].source = g_variant_dup_string(source, NULL);
        config.mappings[index].destination =
            g_variant_dup_string(destination, NULL);
        g_variant_unref(destination);
        g_variant_unref(source);
        g_variant_unref(kind);
        g_variant_unref(mapping);
    }

    g_variant_unref(mappings);
    g_variant_unref(files);
    g_variant_unref(prefixes);
    g_variant_unref(marker);
    g_variant_unref(asset_base);

    g_signal_connect(extension, "page-created", G_CALLBACK(page_created), NULL);
}
