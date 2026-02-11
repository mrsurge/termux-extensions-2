// src/basic-languages/_.contribution.ts
import { languages, editor } from "monaco-editor-core";
var languageDefinitions = {};
var lazyLanguageLoaders = {};
var LazyLanguageLoader = class _LazyLanguageLoader {
  static getOrCreate(languageId) {
    if (!lazyLanguageLoaders[languageId]) {
      lazyLanguageLoaders[languageId] = new _LazyLanguageLoader(languageId);
    }
    return lazyLanguageLoaders[languageId];
  }
  constructor(languageId) {
    this._languageId = languageId;
    this._loadingTriggered = false;
    this._lazyLoadPromise = new Promise((resolve, reject) => {
      this._lazyLoadPromiseResolve = resolve;
      this._lazyLoadPromiseReject = reject;
    });
  }
  load() {
    if (!this._loadingTriggered) {
      this._loadingTriggered = true;
      languageDefinitions[this._languageId].loader().then(
        (mod) => this._lazyLoadPromiseResolve(mod),
        (err) => this._lazyLoadPromiseReject(err)
      );
    }
    return this._lazyLoadPromise;
  }
};
function registerLanguage(def) {
  const languageId = def.id;
  languageDefinitions[languageId] = def;
  languages.register(def);
  const lazyLanguageLoader = LazyLanguageLoader.getOrCreate(languageId);
  languages.registerTokensProviderFactory(languageId, {
    create: async () => {
      const mod = await lazyLanguageLoader.load();
      return mod.language;
    }
  });
  languages.onLanguageEncountered(languageId, async () => {
    const mod = await lazyLanguageLoader.load();
    languages.setLanguageConfiguration(languageId, mod.conf);
  });
}

// src/basic-languages/abap/abap.contribution.ts
registerLanguage({
  id: "abap",
  extensions: [".abap"],
  aliases: ["abap", "ABAP"],
  loader: () => import("../chunk-6MY5FNOO.js")
});

// src/basic-languages/apex/apex.contribution.ts
registerLanguage({
  id: "apex",
  extensions: [".cls"],
  aliases: ["Apex", "apex"],
  mimetypes: ["text/x-apex-source", "text/x-apex"],
  loader: () => import("../chunk-7DKU2HE4.js")
});

// src/basic-languages/azcli/azcli.contribution.ts
registerLanguage({
  id: "azcli",
  extensions: [".azcli"],
  aliases: ["Azure CLI", "azcli"],
  loader: () => import("../chunk-FKM2GFJ3.js")
});

// src/basic-languages/bat/bat.contribution.ts
registerLanguage({
  id: "bat",
  extensions: [".bat", ".cmd"],
  aliases: ["Batch", "bat"],
  loader: () => import("../chunk-NBSZL5HD.js")
});

// src/basic-languages/bicep/bicep.contribution.ts
registerLanguage({
  id: "bicep",
  extensions: [".bicep"],
  aliases: ["Bicep"],
  loader: () => import("../chunk-VSMESCOP.js")
});

// src/basic-languages/cameligo/cameligo.contribution.ts
registerLanguage({
  id: "cameligo",
  extensions: [".mligo"],
  aliases: ["Cameligo"],
  loader: () => import("../chunk-3CDGPN2V.js")
});

// src/basic-languages/clojure/clojure.contribution.ts
registerLanguage({
  id: "clojure",
  extensions: [".clj", ".cljs", ".cljc", ".edn"],
  aliases: ["clojure", "Clojure"],
  loader: () => import("../chunk-RAWUJJBA.js")
});

// src/basic-languages/coffee/coffee.contribution.ts
registerLanguage({
  id: "coffeescript",
  extensions: [".coffee"],
  aliases: ["CoffeeScript", "coffeescript", "coffee"],
  mimetypes: ["text/x-coffeescript", "text/coffeescript"],
  loader: () => import("../chunk-VCBR7HLL.js")
});

// src/basic-languages/cpp/cpp.contribution.ts
registerLanguage({
  id: "c",
  extensions: [".c", ".h"],
  aliases: ["C", "c"],
  loader: () => import("../chunk-22NVRR63.js")
});
registerLanguage({
  id: "cpp",
  extensions: [".cpp", ".cc", ".cxx", ".hpp", ".hh", ".hxx"],
  aliases: ["C++", "Cpp", "cpp"],
  loader: () => import("../chunk-22NVRR63.js")
});

// src/basic-languages/csharp/csharp.contribution.ts
registerLanguage({
  id: "csharp",
  extensions: [".cs", ".csx", ".cake"],
  aliases: ["C#", "csharp"],
  loader: () => import("../chunk-YZY6V53I.js")
});

// src/basic-languages/csp/csp.contribution.ts
registerLanguage({
  id: "csp",
  extensions: [".csp"],
  aliases: ["CSP", "csp"],
  loader: () => import("../chunk-R2HV2ECQ.js")
});

// src/basic-languages/css/css.contribution.ts
registerLanguage({
  id: "css",
  extensions: [".css"],
  aliases: ["CSS", "css"],
  mimetypes: ["text/css"],
  loader: () => import("../chunk-74WOCGCE.js")
});

// src/basic-languages/cypher/cypher.contribution.ts
registerLanguage({
  id: "cypher",
  extensions: [".cypher", ".cyp"],
  aliases: ["Cypher", "OpenCypher"],
  loader: () => import("../chunk-WJ6S4RYL.js")
});

// src/basic-languages/dart/dart.contribution.ts
registerLanguage({
  id: "dart",
  extensions: [".dart"],
  aliases: ["Dart", "dart"],
  mimetypes: ["text/x-dart-source", "text/x-dart"],
  loader: () => import("../chunk-P73C2LPU.js")
});

// src/basic-languages/dockerfile/dockerfile.contribution.ts
registerLanguage({
  id: "dockerfile",
  extensions: [".dockerfile"],
  filenames: ["Dockerfile"],
  aliases: ["Dockerfile"],
  loader: () => import("../chunk-3UL2YL7C.js")
});

// src/basic-languages/ecl/ecl.contribution.ts
registerLanguage({
  id: "ecl",
  extensions: [".ecl"],
  aliases: ["ECL", "Ecl", "ecl"],
  loader: () => import("../chunk-FGNENRNI.js")
});

// src/basic-languages/elixir/elixir.contribution.ts
registerLanguage({
  id: "elixir",
  extensions: [".ex", ".exs"],
  aliases: ["Elixir", "elixir", "ex"],
  loader: () => import("../chunk-QQE4QSER.js")
});

// src/basic-languages/flow9/flow9.contribution.ts
registerLanguage({
  id: "flow9",
  extensions: [".flow"],
  aliases: ["Flow9", "Flow", "flow9", "flow"],
  loader: () => import("../chunk-HNIPNHKB.js")
});

// src/basic-languages/fsharp/fsharp.contribution.ts
registerLanguage({
  id: "fsharp",
  extensions: [".fs", ".fsi", ".ml", ".mli", ".fsx", ".fsscript"],
  aliases: ["F#", "FSharp", "fsharp"],
  loader: () => import("../chunk-CQYITIFM.js")
});

// src/basic-languages/freemarker2/freemarker2.contribution.ts
registerLanguage({
  id: "freemarker2",
  extensions: [".ftl", ".ftlh", ".ftlx"],
  aliases: ["FreeMarker2", "Apache FreeMarker2"],
  loader: () => {
    return import("../chunk-6L4HXBH3.js").then((m) => m.TagAutoInterpolationDollar);
  }
});
registerLanguage({
  id: "freemarker2.tag-angle.interpolation-dollar",
  aliases: ["FreeMarker2 (Angle/Dollar)", "Apache FreeMarker2 (Angle/Dollar)"],
  loader: () => {
    return import("../chunk-6L4HXBH3.js").then((m) => m.TagAngleInterpolationDollar);
  }
});
registerLanguage({
  id: "freemarker2.tag-bracket.interpolation-dollar",
  aliases: ["FreeMarker2 (Bracket/Dollar)", "Apache FreeMarker2 (Bracket/Dollar)"],
  loader: () => {
    return import("../chunk-6L4HXBH3.js").then((m) => m.TagBracketInterpolationDollar);
  }
});
registerLanguage({
  id: "freemarker2.tag-angle.interpolation-bracket",
  aliases: ["FreeMarker2 (Angle/Bracket)", "Apache FreeMarker2 (Angle/Bracket)"],
  loader: () => {
    return import("../chunk-6L4HXBH3.js").then((m) => m.TagAngleInterpolationBracket);
  }
});
registerLanguage({
  id: "freemarker2.tag-bracket.interpolation-bracket",
  aliases: ["FreeMarker2 (Bracket/Bracket)", "Apache FreeMarker2 (Bracket/Bracket)"],
  loader: () => {
    return import("../chunk-6L4HXBH3.js").then((m) => m.TagBracketInterpolationBracket);
  }
});
registerLanguage({
  id: "freemarker2.tag-auto.interpolation-dollar",
  aliases: ["FreeMarker2 (Auto/Dollar)", "Apache FreeMarker2 (Auto/Dollar)"],
  loader: () => {
    return import("../chunk-6L4HXBH3.js").then((m) => m.TagAutoInterpolationDollar);
  }
});
registerLanguage({
  id: "freemarker2.tag-auto.interpolation-bracket",
  aliases: ["FreeMarker2 (Auto/Bracket)", "Apache FreeMarker2 (Auto/Bracket)"],
  loader: () => {
    return import("../chunk-6L4HXBH3.js").then((m) => m.TagAutoInterpolationBracket);
  }
});

// src/basic-languages/go/go.contribution.ts
registerLanguage({
  id: "go",
  extensions: [".go"],
  aliases: ["Go"],
  loader: () => import("../chunk-N2F4WJ2Y.js")
});

// src/basic-languages/graphql/graphql.contribution.ts
registerLanguage({
  id: "graphql",
  extensions: [".graphql", ".gql"],
  aliases: ["GraphQL", "graphql", "gql"],
  mimetypes: ["application/graphql"],
  loader: () => import("../chunk-YHJ4LYQ6.js")
});

// src/basic-languages/handlebars/handlebars.contribution.ts
registerLanguage({
  id: "handlebars",
  extensions: [".handlebars", ".hbs"],
  aliases: ["Handlebars", "handlebars", "hbs"],
  mimetypes: ["text/x-handlebars-template"],
  loader: () => import("../chunk-VDEZQ5CC.js")
});

// src/basic-languages/hcl/hcl.contribution.ts
registerLanguage({
  id: "hcl",
  extensions: [".tf", ".tfvars", ".hcl"],
  aliases: ["Terraform", "tf", "HCL", "hcl"],
  loader: () => import("../chunk-4TYEZLIV.js")
});

// src/basic-languages/html/html.contribution.ts
registerLanguage({
  id: "html",
  extensions: [".html", ".htm", ".shtml", ".xhtml", ".mdoc", ".jsp", ".asp", ".aspx", ".jshtm"],
  aliases: ["HTML", "htm", "html", "xhtml"],
  mimetypes: ["text/html", "text/x-jshtm", "text/template", "text/ng-template"],
  loader: () => import("../chunk-LLJJRK56.js")
});

// src/basic-languages/ini/ini.contribution.ts
registerLanguage({
  id: "ini",
  extensions: [".ini", ".properties", ".gitconfig"],
  filenames: ["config", ".gitattributes", ".gitconfig", ".editorconfig"],
  aliases: ["Ini", "ini"],
  loader: () => import("../chunk-RVSR6VMZ.js")
});

// src/basic-languages/java/java.contribution.ts
registerLanguage({
  id: "java",
  extensions: [".java", ".jav"],
  aliases: ["Java", "java"],
  mimetypes: ["text/x-java-source", "text/x-java"],
  loader: () => import("../chunk-SIKFZJCQ.js")
});

// src/basic-languages/javascript/javascript.contribution.ts
registerLanguage({
  id: "javascript",
  extensions: [".js", ".es6", ".jsx", ".mjs", ".cjs"],
  firstLine: "^#!.*\\bnode",
  filenames: ["jakefile"],
  aliases: ["JavaScript", "javascript", "js"],
  mimetypes: ["text/javascript"],
  loader: () => import("../chunk-4UZQAIHQ.js")
});

// src/basic-languages/julia/julia.contribution.ts
registerLanguage({
  id: "julia",
  extensions: [".jl"],
  aliases: ["julia", "Julia"],
  loader: () => import("../chunk-327JQVCX.js")
});

// src/basic-languages/kotlin/kotlin.contribution.ts
registerLanguage({
  id: "kotlin",
  extensions: [".kt", ".kts"],
  aliases: ["Kotlin", "kotlin"],
  mimetypes: ["text/x-kotlin-source", "text/x-kotlin"],
  loader: () => import("../chunk-GDLXFE26.js")
});

// src/basic-languages/less/less.contribution.ts
registerLanguage({
  id: "less",
  extensions: [".less"],
  aliases: ["Less", "less"],
  mimetypes: ["text/x-less", "text/less"],
  loader: () => import("../chunk-3DBTAEO3.js")
});

// src/basic-languages/lexon/lexon.contribution.ts
registerLanguage({
  id: "lexon",
  extensions: [".lex"],
  aliases: ["Lexon"],
  loader: () => import("../chunk-HC6UE3PO.js")
});

// src/basic-languages/lua/lua.contribution.ts
registerLanguage({
  id: "lua",
  extensions: [".lua"],
  aliases: ["Lua", "lua"],
  loader: () => import("../chunk-JZBGMSFA.js")
});

// src/basic-languages/liquid/liquid.contribution.ts
registerLanguage({
  id: "liquid",
  extensions: [".liquid", ".html.liquid"],
  aliases: ["Liquid", "liquid"],
  mimetypes: ["application/liquid"],
  loader: () => import("../chunk-COOKCO6N.js")
});

// src/basic-languages/m3/m3.contribution.ts
registerLanguage({
  id: "m3",
  extensions: [".m3", ".i3", ".mg", ".ig"],
  aliases: ["Modula-3", "Modula3", "modula3", "m3"],
  loader: () => import("../chunk-QJSFK7YP.js")
});

// src/basic-languages/markdown/markdown.contribution.ts
registerLanguage({
  id: "markdown",
  extensions: [".md", ".markdown", ".mdown", ".mkdn", ".mkd", ".mdwn", ".mdtxt", ".mdtext"],
  aliases: ["Markdown", "markdown"],
  loader: () => import("../chunk-WBWXVTFC.js")
});

// src/basic-languages/mdx/mdx.contribution.ts
registerLanguage({
  id: "mdx",
  extensions: [".mdx"],
  aliases: ["MDX", "mdx"],
  loader: () => import("../chunk-LD7OYVZ4.js")
});

// src/basic-languages/mips/mips.contribution.ts
registerLanguage({
  id: "mips",
  extensions: [".s"],
  aliases: ["MIPS", "MIPS-V"],
  mimetypes: ["text/x-mips", "text/mips", "text/plaintext"],
  loader: () => import("../chunk-RR3OPLSA.js")
});

// src/basic-languages/msdax/msdax.contribution.ts
registerLanguage({
  id: "msdax",
  extensions: [".dax", ".msdax"],
  aliases: ["DAX", "MSDAX"],
  loader: () => import("../chunk-GFODLXOX.js")
});

// src/basic-languages/mysql/mysql.contribution.ts
registerLanguage({
  id: "mysql",
  extensions: [],
  aliases: ["MySQL", "mysql"],
  loader: () => import("../chunk-JSQGCRLC.js")
});

// src/basic-languages/objective-c/objective-c.contribution.ts
registerLanguage({
  id: "objective-c",
  extensions: [".m"],
  aliases: ["Objective-C"],
  loader: () => import("../chunk-2UBRI6SZ.js")
});

// src/basic-languages/pascal/pascal.contribution.ts
registerLanguage({
  id: "pascal",
  extensions: [".pas", ".p", ".pp"],
  aliases: ["Pascal", "pas"],
  mimetypes: ["text/x-pascal-source", "text/x-pascal"],
  loader: () => import("../chunk-SS4MCUD4.js")
});

// src/basic-languages/pascaligo/pascaligo.contribution.ts
registerLanguage({
  id: "pascaligo",
  extensions: [".ligo"],
  aliases: ["Pascaligo", "ligo"],
  loader: () => import("../chunk-HNXLCGDM.js")
});

// src/basic-languages/perl/perl.contribution.ts
registerLanguage({
  id: "perl",
  extensions: [".pl", ".pm"],
  aliases: ["Perl", "pl"],
  loader: () => import("../chunk-7BVTV54I.js")
});

// src/basic-languages/pgsql/pgsql.contribution.ts
registerLanguage({
  id: "pgsql",
  extensions: [],
  aliases: ["PostgreSQL", "postgres", "pg", "postgre"],
  loader: () => import("../chunk-DO7EQC7R.js")
});

// src/basic-languages/php/php.contribution.ts
registerLanguage({
  id: "php",
  extensions: [".php", ".php4", ".php5", ".phtml", ".ctp"],
  aliases: ["PHP", "php"],
  mimetypes: ["application/x-php"],
  loader: () => import("../chunk-R52URPS6.js")
});

// src/basic-languages/pla/pla.contribution.ts
registerLanguage({
  id: "pla",
  extensions: [".pla"],
  loader: () => import("../chunk-KOJUNQFS.js")
});

// src/basic-languages/postiats/postiats.contribution.ts
registerLanguage({
  id: "postiats",
  extensions: [".dats", ".sats", ".hats"],
  aliases: ["ATS", "ATS/Postiats"],
  loader: () => import("../chunk-CIJGPPQJ.js")
});

// src/basic-languages/powerquery/powerquery.contribution.ts
registerLanguage({
  id: "powerquery",
  extensions: [".pq", ".pqm"],
  aliases: ["PQ", "M", "Power Query", "Power Query M"],
  loader: () => import("../chunk-JQXRKZCW.js")
});

// src/basic-languages/powershell/powershell.contribution.ts
registerLanguage({
  id: "powershell",
  extensions: [".ps1", ".psm1", ".psd1"],
  aliases: ["PowerShell", "powershell", "ps", "ps1"],
  loader: () => import("../chunk-THYOHIY6.js")
});

// src/basic-languages/protobuf/protobuf.contribution.ts
registerLanguage({
  id: "proto",
  extensions: [".proto"],
  aliases: ["protobuf", "Protocol Buffers"],
  loader: () => import("../chunk-N3UJ4DMO.js")
});

// src/basic-languages/pug/pug.contribution.ts
registerLanguage({
  id: "pug",
  extensions: [".jade", ".pug"],
  aliases: ["Pug", "Jade", "jade"],
  loader: () => import("../chunk-3JEU2PNY.js")
});

// src/basic-languages/python/python.contribution.ts
registerLanguage({
  id: "python",
  extensions: [".py", ".rpy", ".pyw", ".cpy", ".gyp", ".gypi"],
  aliases: ["Python", "py"],
  firstLine: "^#!/.*\\bpython[0-9.-]*\\b",
  loader: () => import("../chunk-EV365HET.js")
});

// src/basic-languages/qsharp/qsharp.contribution.ts
registerLanguage({
  id: "qsharp",
  extensions: [".qs"],
  aliases: ["Q#", "qsharp"],
  loader: () => import("../chunk-X2BMW3N6.js")
});

// src/basic-languages/r/r.contribution.ts
registerLanguage({
  id: "r",
  extensions: [".r", ".rhistory", ".rmd", ".rprofile", ".rt"],
  aliases: ["R", "r"],
  loader: () => import("../chunk-EZ6SMNEZ.js")
});

// src/basic-languages/razor/razor.contribution.ts
registerLanguage({
  id: "razor",
  extensions: [".cshtml"],
  aliases: ["Razor", "razor"],
  mimetypes: ["text/x-cshtml"],
  loader: () => import("../chunk-WFHWJDFX.js")
});

// src/basic-languages/redis/redis.contribution.ts
registerLanguage({
  id: "redis",
  extensions: [".redis"],
  aliases: ["redis"],
  loader: () => import("../chunk-ZFLNRYWP.js")
});

// src/basic-languages/redshift/redshift.contribution.ts
registerLanguage({
  id: "redshift",
  extensions: [],
  aliases: ["Redshift", "redshift"],
  loader: () => import("../chunk-P44DPZMB.js")
});

// src/basic-languages/restructuredtext/restructuredtext.contribution.ts
registerLanguage({
  id: "restructuredtext",
  extensions: [".rst"],
  aliases: ["reStructuredText", "restructuredtext"],
  loader: () => import("../chunk-FGYQYU6H.js")
});

// src/basic-languages/ruby/ruby.contribution.ts
registerLanguage({
  id: "ruby",
  extensions: [".rb", ".rbx", ".rjs", ".gemspec", ".pp"],
  filenames: ["rakefile", "Gemfile"],
  aliases: ["Ruby", "rb"],
  loader: () => import("../chunk-U7CYB2GA.js")
});

// src/basic-languages/rust/rust.contribution.ts
registerLanguage({
  id: "rust",
  extensions: [".rs", ".rlib"],
  aliases: ["Rust", "rust"],
  loader: () => import("../chunk-OHCPOZOL.js")
});

// src/basic-languages/sb/sb.contribution.ts
registerLanguage({
  id: "sb",
  extensions: [".sb"],
  aliases: ["Small Basic", "sb"],
  loader: () => import("../chunk-D7MITULR.js")
});

// src/basic-languages/scala/scala.contribution.ts
registerLanguage({
  id: "scala",
  extensions: [".scala", ".sc", ".sbt"],
  aliases: ["Scala", "scala", "SBT", "Sbt", "sbt", "Dotty", "dotty"],
  mimetypes: ["text/x-scala-source", "text/x-scala", "text/x-sbt", "text/x-dotty"],
  loader: () => import("../chunk-2M6R7V4B.js")
});

// src/basic-languages/scheme/scheme.contribution.ts
registerLanguage({
  id: "scheme",
  extensions: [".scm", ".ss", ".sch", ".rkt"],
  aliases: ["scheme", "Scheme"],
  loader: () => import("../chunk-C6CRMXE4.js")
});

// src/basic-languages/scss/scss.contribution.ts
registerLanguage({
  id: "scss",
  extensions: [".scss"],
  aliases: ["Sass", "sass", "scss"],
  mimetypes: ["text/x-scss", "text/scss"],
  loader: () => import("../chunk-37PCBMDA.js")
});

// src/basic-languages/shell/shell.contribution.ts
registerLanguage({
  id: "shell",
  extensions: [".sh", ".bash"],
  aliases: ["Shell", "sh"],
  loader: () => import("../chunk-JY3PTJVM.js")
});

// src/basic-languages/solidity/solidity.contribution.ts
registerLanguage({
  id: "sol",
  extensions: [".sol"],
  aliases: ["sol", "solidity", "Solidity"],
  loader: () => import("../chunk-L4S6Z6CH.js")
});

// src/basic-languages/sophia/sophia.contribution.ts
registerLanguage({
  id: "aes",
  extensions: [".aes"],
  aliases: ["aes", "sophia", "Sophia"],
  loader: () => import("../chunk-2ZLXBWWQ.js")
});

// src/basic-languages/sparql/sparql.contribution.ts
registerLanguage({
  id: "sparql",
  extensions: [".rq"],
  aliases: ["sparql", "SPARQL"],
  loader: () => import("../chunk-4WVGAGAO.js")
});

// src/basic-languages/sql/sql.contribution.ts
registerLanguage({
  id: "sql",
  extensions: [".sql"],
  aliases: ["SQL"],
  loader: () => import("../chunk-PCBDJUZU.js")
});

// src/basic-languages/st/st.contribution.ts
registerLanguage({
  id: "st",
  extensions: [".st", ".iecst", ".iecplc", ".lc3lib", ".TcPOU", ".TcDUT", ".TcGVL", ".TcIO"],
  aliases: ["StructuredText", "scl", "stl"],
  loader: () => import("../chunk-BXGOJJTM.js")
});

// src/basic-languages/swift/swift.contribution.ts
registerLanguage({
  id: "swift",
  aliases: ["Swift", "swift"],
  extensions: [".swift"],
  mimetypes: ["text/swift"],
  loader: () => import("../chunk-OLL24XET.js")
});

// src/basic-languages/systemverilog/systemverilog.contribution.ts
registerLanguage({
  id: "systemverilog",
  extensions: [".sv", ".svh"],
  aliases: ["SV", "sv", "SystemVerilog", "systemverilog"],
  loader: () => import("../chunk-HIBNJ6D7.js")
});
registerLanguage({
  id: "verilog",
  extensions: [".v", ".vh"],
  aliases: ["V", "v", "Verilog", "verilog"],
  loader: () => import("../chunk-HIBNJ6D7.js")
});

// src/basic-languages/tcl/tcl.contribution.ts
registerLanguage({
  id: "tcl",
  extensions: [".tcl"],
  aliases: ["tcl", "Tcl", "tcltk", "TclTk", "tcl/tk", "Tcl/Tk"],
  loader: () => import("../chunk-KO7VECBH.js")
});

// src/basic-languages/twig/twig.contribution.ts
registerLanguage({
  id: "twig",
  extensions: [".twig"],
  aliases: ["Twig", "twig"],
  mimetypes: ["text/x-twig"],
  loader: () => import("../chunk-55Q6FBHM.js")
});

// src/basic-languages/typescript/typescript.contribution.ts
registerLanguage({
  id: "typescript",
  extensions: [".ts", ".tsx", ".cts", ".mts"],
  aliases: ["TypeScript", "ts", "typescript"],
  mimetypes: ["text/typescript"],
  loader: () => {
    return import("../chunk-R2VSZ67B.js");
  }
});

// src/basic-languages/typespec/typespec.contribution.ts
registerLanguage({
  id: "typespec",
  extensions: [".tsp"],
  aliases: ["TypeSpec"],
  loader: () => import("../chunk-2JICCLTR.js")
});

// src/basic-languages/vb/vb.contribution.ts
registerLanguage({
  id: "vb",
  extensions: [".vb"],
  aliases: ["Visual Basic", "vb"],
  loader: () => import("../chunk-GNNFSNDF.js")
});

// src/basic-languages/wgsl/wgsl.contribution.ts
registerLanguage({
  id: "wgsl",
  extensions: [".wgsl"],
  aliases: ["WebGPU Shading Language", "WGSL", "wgsl"],
  loader: () => import("../chunk-JBJSXQEV.js")
});

// src/basic-languages/xml/xml.contribution.ts
registerLanguage({
  id: "xml",
  extensions: [
    ".xml",
    ".xsd",
    ".dtd",
    ".ascx",
    ".csproj",
    ".config",
    ".props",
    ".targets",
    ".wxi",
    ".wxl",
    ".wxs",
    ".xaml",
    ".svg",
    ".svgz",
    ".opf",
    ".xslt",
    ".xsl"
  ],
  firstLine: "(\\<\\?xml.*)|(\\<svg)|(\\<\\!doctype\\s+svg)",
  aliases: ["XML", "xml"],
  mimetypes: ["text/xml", "application/xml", "application/xaml+xml", "application/xml-dtd"],
  loader: () => import("../chunk-JO2HIWUD.js")
});

// src/basic-languages/yaml/yaml.contribution.ts
registerLanguage({
  id: "yaml",
  extensions: [".yaml", ".yml"],
  aliases: ["YAML", "yaml", "YML", "yml"],
  mimetypes: ["application/x-yaml", "text/x-yaml"],
  loader: () => import("../chunk-EAIST2F3.js")
});
//# sourceMappingURL=monaco.contribution.js.map
