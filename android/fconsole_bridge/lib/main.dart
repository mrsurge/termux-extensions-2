import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

/// Entry point for the Flutter module embedded in the TE2 tools overlay.
/// Receives console events from Kotlin via EventChannel and renders them.
@pragma('vm:entry-point')
void main() => runApp(const ConsoleBridgeApp());

class ConsoleBridgeApp extends StatelessWidget {
  const ConsoleBridgeApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      theme: ThemeData.dark().copyWith(
        scaffoldBackgroundColor: const Color(0xFF1A1A2E),
        popupMenuTheme: const PopupMenuThemeData(
          color: Color(0xFF16213E),
          textStyle: TextStyle(color: Colors.white70, fontSize: 12),
        ),
      ),
      home: const Scaffold(
        backgroundColor: Color(0xFF1A1A2E),
        body: ConsoleBridgeView(),
      ),
    );
  }
}

class ConsoleBridgeView extends StatefulWidget {
  const ConsoleBridgeView({super.key});

  @override
  State<ConsoleBridgeView> createState() => _ConsoleBridgeViewState();
}

/// Level filter options
enum _LevelFilter { all, log, warn, error }

class _ConsoleBridgeViewState extends State<ConsoleBridgeView> {
  static const _eventChannel =
      EventChannel('com.termux.extensions/console_events');
  static const _methodChannel =
      MethodChannel('com.termux.extensions/console_eval');

  final TextEditingController _evalController = TextEditingController();
  final TextEditingController _searchController = TextEditingController();
  final ScrollController _scrollController = ScrollController();
  final List<_ConsoleEntry> _allEntries = [];

  // Filtering state
  final Set<String> _knownWorkers = {};
  String _activeWorkerFilter = 'all';
  _LevelFilter _activeLevelFilter = _LevelFilter.all;
  String _searchQuery = '';

  List<_ConsoleEntry> get _filteredEntries {
    final query = _searchQuery.toLowerCase();
    return _allEntries.where((e) {
      if (_activeWorkerFilter != 'all' && e.workerId != _activeWorkerFilter) {
        return false;
      }
      if (query.isNotEmpty && !e.message.toLowerCase().contains(query)) {
        return false;
      }
      switch (_activeLevelFilter) {
        case _LevelFilter.log:
          return e.level == 'log' || e.level == 'info' || e.level == 'debug';
        case _LevelFilter.warn:
          return e.level == 'warn';
        case _LevelFilter.error:
          return e.level == 'error';
        case _LevelFilter.all:
          return true;
      }
    }).toList();
  }

  @override
  void initState() {
    super.initState();
    _eventChannel.receiveBroadcastStream().listen(
      _onConsoleEvent,
      onError: (e) => debugPrint('Console EventChannel error: $e'),
    );
  }

  void _onConsoleEvent(dynamic event) {
    if (event is! String) return;
    try {
      final data = jsonDecode(event) as Map<String, dynamic>;
      final type = data['event'] as String? ?? '';

      switch (type) {
        case 'console:log':
          _addLogEntry(data);
          break;
        case 'console:evalResult':
          _addEvalResult(data);
          break;
        case 'console:clear':
          setState(() => _allEntries.clear());
          break;
        case 'console:workers':
          _updateWorkers(data);
          break;
      }
    } catch (e) {
      debugPrint('Error parsing console event: $e');
    }
  }

  void _updateWorkers(Map<String, dynamic> data) {
    // console:workers payload has a "workers" key with list of worker IDs
    // or the data itself might be the list merged into envelope
    final workers = data['workers'];
    if (workers is List) {
      setState(() {
        for (final w in workers) {
          if (w is String && w.isNotEmpty) _knownWorkers.add(w);
        }
      });
    }
  }

  void _addLogEntry(Map<String, dynamic> data) {
    final level = data['level'] as String? ?? 'log';
    final workerId = data['workerId'] as String? ?? '?';
    final args = data['args'] as List<dynamic>? ?? [];
    final ts = data['ts'] as int? ?? 0;
    final time = DateTime.fromMillisecondsSinceEpoch(ts);

    if (workerId != '?') _knownWorkers.add(workerId);

    final message = args.map((a) => _formatArg(a)).join(' ');
    final entry = _ConsoleEntry(
      level: level,
      workerId: workerId,
      message: message,
      time: time,
    );

    setState(() {
      _allEntries.add(entry);
      if (_allEntries.length > 1000) _allEntries.removeAt(0);
    });
    _autoScroll();
  }

  void _addEvalResult(Map<String, dynamic> data) {
    final ok = data['ok'] as bool? ?? false;
    final value = data['value'];
    final error = data['error'];

    final entry = _ConsoleEntry(
      level: ok ? 'info' : 'error',
      workerId: 'eval',
      message:
          ok ? '\u2190 ${_formatArg(value)}' : '\u2717 ${_formatArg(error)}',
      time: DateTime.now(),
    );

    setState(() => _allEntries.add(entry));
    _autoScroll();
  }

  String _formatArg(dynamic arg) {
    if (arg is String) return arg;
    if (arg is Map || arg is List) {
      try {
        return const JsonEncoder.withIndent('  ').convert(arg);
      } catch (_) {}
    }
    return arg.toString();
  }

  void _autoScroll() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scrollController.hasClients) {
        _scrollController.animateTo(
          _scrollController.position.maxScrollExtent,
          duration: const Duration(milliseconds: 100),
          curve: Curves.easeOut,
        );
      }
    });
  }

  Future<void> _sendEval() async {
    final code = _evalController.text.trim();
    if (code.isEmpty) return;
    _evalController.clear();

    setState(() {
      _allEntries.add(_ConsoleEntry(
        level: 'debug',
        workerId: 'eval',
        message: '\u2192 $code',
        time: DateTime.now(),
      ));
    });
    _autoScroll();

    try {
      await _methodChannel.invokeMethod('eval', {'code': code});
    } catch (e) {
      setState(() {
        _allEntries.add(_ConsoleEntry(
          level: 'error',
          workerId: 'eval',
          message: 'Send failed: $e',
          time: DateTime.now(),
        ));
      });
    }
  }

  Color _levelColor(String level) {
    switch (level) {
      case 'error':
        return const Color(0xFFFF6B6B);
      case 'warn':
        return const Color(0xFFFFD93D);
      case 'info':
        return const Color(0xFF6BCB77);
      case 'debug':
        return const Color(0xFF9B9B9B);
      default:
        return const Color(0xFFE0E0E0);
    }
  }

  int _countForLevel(_LevelFilter filter) {
    switch (filter) {
      case _LevelFilter.all:
        return _allEntries
            .where((e) =>
                _activeWorkerFilter == 'all' ||
                e.workerId == _activeWorkerFilter)
            .length;
      case _LevelFilter.log:
        return _allEntries
            .where((e) =>
                (_activeWorkerFilter == 'all' ||
                    e.workerId == _activeWorkerFilter) &&
                (e.level == 'log' || e.level == 'info' || e.level == 'debug'))
            .length;
      case _LevelFilter.warn:
        return _allEntries
            .where((e) =>
                (_activeWorkerFilter == 'all' ||
                    e.workerId == _activeWorkerFilter) &&
                e.level == 'warn')
            .length;
      case _LevelFilter.error:
        return _allEntries
            .where((e) =>
                (_activeWorkerFilter == 'all' ||
                    e.workerId == _activeWorkerFilter) &&
                e.level == 'error')
            .length;
    }
  }

  Widget _buildLevelTab(_LevelFilter filter, String label, Color color) {
    final isActive = _activeLevelFilter == filter;
    final count = _countForLevel(filter);
    return GestureDetector(
      onTap: () => setState(() => _activeLevelFilter = filter),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
        decoration: BoxDecoration(
          color: isActive ? color.withValues(alpha: 0.25) : Colors.transparent,
          borderRadius: BorderRadius.circular(4),
          border: isActive
              ? Border.all(color: color.withValues(alpha: 0.5), width: 1)
              : null,
        ),
        child: Text(
          count > 0 ? '$label ($count)' : label,
          style: TextStyle(
            color: isActive ? color : Colors.white38,
            fontSize: 10,
            fontWeight: isActive ? FontWeight.bold : FontWeight.normal,
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final filtered = _filteredEntries;

    return Column(
      children: [
        // Header row: icon, title, worker selector, clear button
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
          color: const Color(0xFF16213E),
          child: Row(
            children: [
              const Icon(Icons.terminal, color: Colors.white70, size: 16),
              const SizedBox(width: 6),
              const Text(
                'Console',
                style: TextStyle(
                  color: Colors.white70,
                  fontSize: 12,
                  fontWeight: FontWeight.bold,
                ),
              ),
              const SizedBox(width: 12),
              // Worker selector dropdown
              _buildWorkerSelector(),
              const Spacer(),
              Text(
                '${filtered.length}',
                style: const TextStyle(color: Colors.white38, fontSize: 11),
              ),
              const SizedBox(width: 8),
              GestureDetector(
                onTap: () => setState(() => _allEntries.clear()),
                child: const Icon(Icons.delete_outline,
                    color: Colors.white54, size: 16),
              ),
            ],
          ),
        ),
        // Level filter tabs + search field
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
          color: const Color(0xFF16213E).withValues(alpha: 0.7),
          child: Row(
            children: [
              _buildLevelTab(
                  _LevelFilter.all, 'All', const Color(0xFFE0E0E0)),
              const SizedBox(width: 6),
              _buildLevelTab(
                  _LevelFilter.log, 'Log', const Color(0xFF6BCB77)),
              const SizedBox(width: 6),
              _buildLevelTab(
                  _LevelFilter.warn, 'Warn', const Color(0xFFFFD93D)),
              const SizedBox(width: 6),
              _buildLevelTab(
                  _LevelFilter.error, 'Error', const Color(0xFFFF6B6B)),
              const SizedBox(width: 8),
              // Word filter
              Expanded(
                child: SizedBox(
                  height: 22,
                  child: TextField(
                    controller: _searchController,
                    style: const TextStyle(
                      color: Colors.white70,
                      fontSize: 10,
                      fontFamily: 'monospace',
                    ),
                    decoration: InputDecoration(
                      isDense: true,
                      contentPadding: const EdgeInsets.symmetric(
                          horizontal: 6, vertical: 4),
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(4),
                        borderSide: BorderSide(
                            color: Colors.white.withValues(alpha: 0.15)),
                      ),
                      enabledBorder: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(4),
                        borderSide: BorderSide(
                            color: Colors.white.withValues(alpha: 0.15)),
                      ),
                      focusedBorder: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(4),
                        borderSide: const BorderSide(
                            color: Color(0xFF6BCB77), width: 1),
                      ),
                      hintText: 'Filter...',
                      hintStyle: const TextStyle(
                          color: Colors.white24, fontSize: 10),
                      suffixIcon: _searchQuery.isNotEmpty
                          ? GestureDetector(
                              onTap: () {
                                _searchController.clear();
                                setState(() => _searchQuery = '');
                              },
                              child: const Icon(Icons.close,
                                  color: Colors.white38, size: 12),
                            )
                          : null,
                      suffixIconConstraints:
                          const BoxConstraints(maxHeight: 20, maxWidth: 20),
                    ),
                    onChanged: (v) => setState(() => _searchQuery = v.trim()),
                  ),
                ),
              ),
            ],
          ),
        ),
        // Log list — wrapped in SelectionArea for copy/paste
        Expanded(
          child: filtered.isEmpty
              ? const Center(
                  child: Text(
                    'No console output yet',
                    style: TextStyle(color: Colors.white24, fontSize: 12),
                  ),
                )
              : SelectionArea(
                  key: ValueKey('sel_${filtered.length}'),
                  child: ListView.builder(
                    controller: _scrollController,
                    padding: const EdgeInsets.all(4),
                    itemCount: filtered.length,
                    itemBuilder: (ctx, i) => _buildLogRow(filtered[i]),
                  ),
                ),
        ),
        // Eval input
        Container(
          padding: const EdgeInsets.all(4),
          color: const Color(0xFF0F3460),
          child: Row(
            children: [
              const Text('\u203a',
                  style: TextStyle(
                      color: Colors.white54,
                      fontSize: 14,
                      fontFamily: 'monospace')),
              const SizedBox(width: 4),
              Expanded(
                child: TextField(
                  controller: _evalController,
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 12,
                    fontFamily: 'monospace',
                  ),
                  decoration: const InputDecoration(
                    isDense: true,
                    contentPadding:
                        EdgeInsets.symmetric(horizontal: 4, vertical: 6),
                    border: InputBorder.none,
                    hintText: 'eval...',
                    hintStyle: TextStyle(color: Colors.white24, fontSize: 12),
                  ),
                  onSubmitted: (_) => _sendEval(),
                ),
              ),
              GestureDetector(
                onTap: _sendEval,
                child:
                    const Icon(Icons.send, color: Colors.white54, size: 16),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildWorkerSelector() {
    final items = ['all', ..._knownWorkers.toList()..sort()];
    return PopupMenuButton<String>(
      onSelected: (value) => setState(() => _activeWorkerFilter = value),
      padding: EdgeInsets.zero,
      constraints: const BoxConstraints(),
      position: PopupMenuPosition.under,
      itemBuilder: (_) => items
          .map((w) => PopupMenuItem<String>(
                value: w,
                height: 32,
                child: Row(
                  children: [
                    if (w == _activeWorkerFilter)
                      const Icon(Icons.check, size: 14, color: Colors.white70)
                    else
                      const SizedBox(width: 14),
                    const SizedBox(width: 6),
                    Text(
                      w == 'all' ? 'All sources' : w,
                      style: TextStyle(
                        color: w == _activeWorkerFilter
                            ? Colors.white
                            : Colors.white70,
                        fontSize: 12,
                      ),
                    ),
                  ],
                ),
              ))
          .toList(),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
        decoration: BoxDecoration(
          color: const Color(0xFF0F3460),
          borderRadius: BorderRadius.circular(4),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              _activeWorkerFilter == 'all'
                  ? 'All sources'
                  : _activeWorkerFilter,
              style: const TextStyle(color: Colors.white70, fontSize: 11),
            ),
            const SizedBox(width: 2),
            const Icon(Icons.arrow_drop_down, color: Colors.white54, size: 14),
          ],
        ),
      ),
    );
  }

  Widget _buildLogRow(_ConsoleEntry e) {
    final timeStr = '${e.time.hour.toString().padLeft(2, '0')}:'
        '${e.time.minute.toString().padLeft(2, '0')}:'
        '${e.time.second.toString().padLeft(2, '0')}';
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 1),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            timeStr,
            style: const TextStyle(
              color: Colors.white24,
              fontSize: 10,
              fontFamily: 'monospace',
            ),
          ),
          const SizedBox(width: 4),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 3),
            decoration: BoxDecoration(
              color: _levelColor(e.level).withValues(alpha: 0.2),
              borderRadius: BorderRadius.circular(2),
            ),
            child: Text(
              e.level.isEmpty ? '?' : e.level.substring(0, 1).toUpperCase(),
              style: TextStyle(
                color: _levelColor(e.level),
                fontSize: 10,
                fontFamily: 'monospace',
                fontWeight: FontWeight.bold,
              ),
            ),
          ),
          const SizedBox(width: 4),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 3),
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: 0.06),
              borderRadius: BorderRadius.circular(2),
            ),
            child: Text(
              e.workerId,
              style: const TextStyle(
                color: Colors.white30,
                fontSize: 9,
                fontFamily: 'monospace',
              ),
            ),
          ),
          const SizedBox(width: 4),
          Expanded(
            child: Text(
              e.message,
              style: TextStyle(
                color: _levelColor(e.level),
                fontSize: 11,
                fontFamily: 'monospace',
              ),
            ),
          ),
        ],
      ),
    );
  }

  @override
  void dispose() {
    _evalController.dispose();
    _searchController.dispose();
    _scrollController.dispose();
    super.dispose();
  }
}

class _ConsoleEntry {
  final String level;
  final String workerId;
  final String message;
  final DateTime time;

  _ConsoleEntry({
    required this.level,
    required this.workerId,
    required this.message,
    required this.time,
  });
}
