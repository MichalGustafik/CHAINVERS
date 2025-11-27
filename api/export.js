import fs from "fs";
import path from "path";
import JSZip from "jszip";

function scanAllFiles(dir, base = process.cwd()) {
  let results = [];

  fs.readdirSync(dir).forEach(file => {
    const full = path.join(dir, file);

    if (
      file === "node_modules" ||
      file === ".vercel" ||
      file === ".git" ||
      file === ".next" ||
      file === "tmp_back" ||
      file === "backup.php"
    ) return;

    if (fs.statSync(full).isDirectory()) {
      results = results.concat(scanAllFiles(full, base));
    } else {
      const relative = full.replace(base + "/", "");
      results.push(relative);
    }
  });

  return results;
}

export default async function handler(req, res) {
  const root = process.cwd();
  const files = scanAllFiles(root);

  const zip = new JSZip();

  for (const filePath of files) {
    const abs = path.join(root, filePath);

    try {
      const data = fs.readFileSync(abs, "utf8");
      zip.file(filePath, data);
    } catch (e) {
      try {
        const data = fs.readFileSync(abs);
        zip.file(filePath, data);
      } catch (err) {}
    }
  }

  const zipData = await zip.generateAsync({ type: "nodebuffer" });

  res.setHeader("Content-Type", "application/zip");
  res.setHeader(
    "Content-Disposition",
    "attachment; filename=\"vercel_full_project.zip\""
  );
  res.status(200).send(zipData);
}
