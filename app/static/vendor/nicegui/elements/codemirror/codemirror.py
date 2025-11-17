from typing import Any, Awaitable, Callable, Literal, Optional, get_args

from nicegui.elements.mixins.disableable_element import DisableableElement
from nicegui.elements.mixins.value_element import ValueElement
from nicegui.events import GenericEventArguments, Handler, ValueChangeEventArguments

SUPPORTED_LANGUAGES = Literal[
    'Angular Template',
    'APL',
    'ASN.1',
    'Asterisk',
    'Brainfuck',
    'C',
    'C#',
    'C++',
    'Clojure',
    'ClojureScript',
    'Closure Stylesheets (GSS)',
    'CMake',
    'Cobol',
    'CoffeeScript',
    'Common Lisp',
    'CQL',
    'Crystal',
    'CSS',
    'Cypher',
    'Cython',
    'D',
    'Dart',
    'diff',
    'Dockerfile',
    'DTD',
    'Dylan',
    'EBNF',
    'ECL',
    'edn',
    'Eiffel',
    'Elm',
    'Erlang',
    'Esper',
    'F#',
    'Factor',
    'FCL',
    'Forth',
    'Fortran',
    'Gas',
    'Gherkin',
    'Go',
    'Groovy',
    'Haskell',
    'Haxe',
    'HTML',
    'HTTP',
    'HXML',
    'IDL',
    'Java',
    'JavaScript',
    'Jinja2',
    'JSON',
    'JSON-LD',
    'JSX',
    'Julia',
    'Kotlin',
    'LaTeX',
    'LESS',
    'Liquid',
    'LiveScript',
    'Lua',
    'MariaDB SQL',
    'Markdown',
    'Mathematica',
    'Mbox',
    'mIRC',
    'Modelica',
    'MS SQL',
    'MscGen',
    'MsGenny',
    'MUMPS',
    'MySQL',
    'Nginx',
    'NSIS',
    'NTriples',
    'Objective-C',
    'Objective-C++',
    'OCaml',
    'Octave',
    'Oz',
    'Pascal',
    'Perl',
    'PGP',
    'PHP',
    'Pig',
    'PLSQL',
    'PostgreSQL',
    'PowerShell',
    'Properties files',
    'ProtoBuf',
    'Pug',
    'Puppet',
    'Python',
    'Q',
    'R',
    'RPM Changes',
    'RPM Spec',
    'Ruby',
    'Rust',
    'SAS',
    'Sass',
    'Scala',
    'Scheme',
    'SCSS',
    'Shell',
    'Sieve',
    'Smalltalk',
    'SML',
    'Solr',
    'SPARQL',
    'Spreadsheet',
    'SQL',
    'SQLite',
    'Squirrel',
    'sTeX',
    'Stylus',
    'Swift',
    'SystemVerilog',
    'Tcl',
    'Textile',
    'TiddlyWiki',
    'Tiki wiki',
    'TOML',
    'Troff',
    'TSX',
    'TTCN',
    'TTCN_CFG',
    'Turtle',
    'TypeScript',
    'VB.NET',
    'VBScript',
    'Velocity',
    'Verilog',
    'VHDL',
    'Vue',
    'Web IDL',
    'WebAssembly',
    'XML',
    'XQuery',
    'Xù',
    'Yacas',
    'YAML',
    'Z80',
]


SUPPORTED_THEMES = Literal[
    'abcdef',
    'abcdefDarkStyle',
    'abyss',
    'abyssDarkStyle',
    'androidstudio',
    'androidstudioDarkStyle',
    'andromeda',
    'andromedaDarkStyle',
    'atomone',
    'atomoneDarkStyle',
    'aura',
    'auraDarkStyle',
    'basicDark',
    'basicDarkStyle',
    'basicLight',
    'basicLightStyle',
    'bbedit',
    'bbeditLightStyle',
    'bespin',
    'bespinDarkStyle',
    'consoleDark',
    'consoleLight',
    'copilot',
    'copilotDarkStyle',
    'darcula',
    'darculaDarkStyle',
    'douToneLightStyle',
    'dracula',
    'draculaDarkStyle',
    'duotoneDark',
    'duotoneDarkStyle',
    'duotoneLight',
    'eclipse',
    'eclipseLightStyle',
    'githubDark',
    'githubDarkStyle',
    'githubLight',
    'githubLightStyle',
    'gruvboxDark',
    'gruvboxDarkStyle',
    'gruvboxLight',
    'kimbie',
    'kimbieDarkStyle',
    'material',
    'materialDark',
    'materialDarkStyle',
    'materialLight',
    'materialLightStyle',
    'monokai',
    'monokaiDarkStyle',
    'monokaiDimmed',
    'monokaiDimmedDarkStyle',
    'noctisLilac',
    'noctisLilacLightStyle',
    'nord',
    'nordDarkStyle',
    'okaidia',
    'okaidiaDarkStyle',
    'oneDark',
    'quietlight',
    'quietlightStyle',
    'red',
    'redDarkStyle',
    'solarizedDark',
    'solarizedDarkStyle',
    'solarizedLight',
    'solarizedLightStyle',
    'sublime',
    'sublimeDarkStyle',
    'tokyoNight',
    'tokyoNightDay',
    'tokyoNightDayStyle',
    'tokyoNightStorm',
    'tokyoNightStormStyle',
    'tokyoNightStyle',
    'tomorrowNightBlue',
    'tomorrowNightBlueStyle',
    'vscodeDark',
    'vscodeDarkStyle',
    'vscodeLight',
    'vscodeLightStyle',
    'whiteDark',
    'whiteDarkStyle',
    'whiteLight',
    'whiteLightStyle',
    'xcodeDark',
    'xcodeDarkStyle',
    'xcodeLight',
    'xcodeLightStyle',
]


class CodeMirror(ValueElement, DisableableElement,
                 component='codemirror.js',
                 esm={'nicegui-codemirror': 'dist'},
                 default_classes='nicegui-codemirror'):
    VALUE_PROP = 'value'
    LOOPBACK = None

    def __init__(
        self,
        value: str = '',
        *,
        on_change: Optional[Callable[..., Any]] = None,
        language: Optional[SUPPORTED_LANGUAGES] = None,
        theme: SUPPORTED_THEMES = 'basicLight',
        indent: str = ' ' * 4,
        line_wrapping: bool = False,
        highlight_whitespace: bool = False,
    ) -> None:
        """CodeMirror

        An element to create a code editor using `CodeMirror <https://codemirror.net/>`_.

        It supports syntax highlighting for over 140 languages, more than 30 themes, line numbers, code folding, (limited) auto-completion, and more.

        Supported languages and themes:
            - Languages: A list of supported languages can be found in the `@codemirror/language-data <https://github.com/codemirror/language-data/blob/main/src/language-data.ts>`_ package.
            - Themes: A list can be found in the `@uiw/codemirror-themes-all <https://github.com/uiwjs/react-codemirror/tree/master/themes/all>`_ package.

        At runtime, the methods `supported_languages` and `supported_themes` can be used to get supported languages and themes.

        :param value: initial value of the editor (default: "")
        :param on_change: callback to be executed when the value changes (default: `None`)
        :param language: initial language of the editor (case-insensitive, default: `None`)
        :param theme: initial theme of the editor (default: "basicLight")
        :param indent: string to use for indentation (any string consisting entirely of the same whitespace character, default: "    ")
        :param line_wrapping: whether to wrap lines (default: `False`)
        :param highlight_whitespace: whether to highlight whitespace (default: `False`)
        """
        super().__init__(value=value, on_value_change=on_change)
        # Prevent ValueElement from pushing model-value updates back to the client; we only
        # need the server-side state and dispatch explicit JS updates when required.
        self._send_update_on_value_change = False

        self._props['language'] = language
        self._props['theme'] = theme
        self._props['indent'] = indent
        self._props['lineWrapping'] = line_wrapping
        self._props['highlightWhitespace'] = highlight_whitespace
        self._update_method = 'setEditorValueFromProps'

        self.on('change', self._handle_change)

    def _handle_change(self, e: GenericEventArguments) -> None:
        # Directly set the value property, which will trigger _handle_value_change
        # and update the BindableProperty storage, but won't enqueue prop updates
        # back to the client (because _send_update_on_value_change is False).
        self.value = e.args['value']

    @property
    def theme(self) -> str:
        """The current theme of the editor."""
        return self._props['theme']

    @theme.setter
    def theme(self, theme: SUPPORTED_THEMES) -> None:
        self._props['theme'] = theme

    def set_theme(self, theme: SUPPORTED_THEMES) -> None:
        """Sets the theme of the editor."""
        self._props['theme'] = theme

    @property
    def supported_themes(self) -> list[str]:
        """List of supported themes."""
        return list(get_args(SUPPORTED_THEMES))

    @property
    def language(self) -> str:
        """The current language of the editor."""
        return self._props['language']

    @language.setter
    def language(self, language: Optional[SUPPORTED_LANGUAGES] = None) -> None:
        self._props['language'] = language

    def set_language(self, language: Optional[SUPPORTED_LANGUAGES] = None) -> None:
        """Sets the language of the editor (case-insensitive)."""
        self._props['language'] = language

    @property
    def supported_languages(self) -> list[str]:
        """List of supported languages."""
        return list(get_args(SUPPORTED_LANGUAGES))

    @property
    def line_wrapping(self) -> bool:
        """Whether line wrapping is enabled

        *Added in version 3.2.0*
        """
        return self._props['lineWrapping']

    @line_wrapping.setter
    def line_wrapping(self, value: bool) -> None:
        self._props['lineWrapping'] = value

    def set_line_wrapping(self, value: bool) -> None:
        """Sets whether line wrapping is enabled.

        *Added in version 3.2.0*
        """
        self._props['lineWrapping'] = value

    def set_zebra_stripes(self, enabled: bool) -> None:
        """Toggles logical-line zebra striping (alternating line colors).
        
        This applies to logical lines (document lines), not visual lines,
        so it works correctly with word wrapping enabled.
        """
        # Use run_method to call the JS function we'll add to codemirror.js
        self.run_method('applyZebraStripes', enabled)

    def set_font_scale(self, scale: float) -> None:
        """Adjust base font scaling (1.0 = 100%)."""
        self.run_method('setFontScale', scale)

    def set_indent_guides(self, enabled: bool) -> None:
        """Toggle indentation guide lines."""
        self.run_method('applyIndentGuides', enabled)

    def set_diff_decorations(self, hunks: list) -> None:
        """Apply inline git diff decorations to the editor.
        
        Args:
            hunks: List of diff hunks from diff_helper.collect_diff()
                Each hunk has: {oldStart, oldLines, newStart, newLines, lines: [{type, text}]}
        """
        self.run_method('applyDiffDecorations', hunks)

    def open_search_panel(self) -> None:
        """Open the CodeMirror search panel (find/replace)."""
        self.run_method('openSearchPanelFromServer')

    # ============================================================================
    # CUSTOM METHOD: jump_to_line
    # Added: 2025-11-17 by TE-2 Team
    # Purpose: Jump to a specific line number in the editor
    # Used by: Explorer search feature, Go To Line menu
    # Note: Calls vendored JavaScript jumpToLine() method via run_method()
    # ============================================================================
    def jump_to_line(self, line: int) -> None:
        """Jump to a specific line in the editor.
        
        Args:
            line: The line number to jump to (1-based indexing)
            
        Example:
            editor.jump_to_line(42)  # Jumps to line 42
        """
        self.run_method('jumpToLine', line)
    # ============================================================================

    def request_content(self) -> Awaitable[str]:
        """Request the current editor content from the frontend.

        This is useful when the value is needed on the backend, but the `on_change` event is not frequent enough.
        """
        return self.run_method('request_content')

    def _event_args_to_value(self, e: GenericEventArguments) -> Any:
        return e.args['value']
