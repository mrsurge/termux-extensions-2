// Current-directory names only. The owner enforces a deadline by terminating us.
self.onmessage = ({ data }) => {
  try {
    const { pattern, names } = data;
    if (typeof pattern !== 'string' || pattern.length > 256 || !Array.isArray(names) || names.length > 20000 || names.some(name => typeof name !== 'string' || name.length > 4096) || names.reduce((size, name) => size + name.length, 0) > 1048576) {
      throw new Error('Regex input exceeds the filter limits.');
    }
    const regex = new RegExp(pattern, 'i');
    const indices = [];
    names.forEach((name, index) => { if (regex.test(name)) indices.push(index); });
    self.postMessage({ indices });
  } catch (error) {
    self.postMessage({ error: error instanceof SyntaxError ? 'Invalid regular expression.' : error.message });
  }
};
