(function () {
  let ttl = "24";
  const seg = document.getElementById("ttl");
  if (seg) {
    seg.querySelectorAll("button").forEach(function (b) {
      b.addEventListener("click", function () {
        seg.querySelectorAll("button").forEach(function (x) { x.classList.remove("on"); });
        b.classList.add("on");
        ttl = b.getAttribute("data-v");
      });
    });
  }
  const btn = document.getElementById("upload");
  const box = document.getElementById("result");
  const fileInput = document.getElementById("file");
  const content = document.getElementById("content");
  if (!btn) return;
  btn.addEventListener("click", async function () {
    btn.disabled = true;
    btn.textContent = "Uploading…";
    box.hidden = true;
    try {
      const fd = new FormData();
      fd.set("ttl", ttl);
      if (fileInput.files && fileInput.files[0]) {
        fd.set("file", fileInput.files[0]);
      } else {
        fd.set("content", content.value || "");
        fd.set("filename", "paste.txt");
      }
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const data = await res.json();
      box.hidden = false;
      if (!res.ok) {
        box.className = "result err";
        box.textContent = data.error || "upload_failed";
      } else {
        box.className = "result ok";
        const u = data.url || ("/raw/" + data.id);
        box.innerHTML = "Uploaded<br><a href=\"" + u + "\" target=\"_blank\" rel=\"noreferrer\">" + u + "</a>";
      }
    } catch (e) {
      box.hidden = false;
      box.className = "result err";
      box.textContent = "network_error";
    } finally {
      btn.disabled = false;
      btn.textContent = "Upload";
    }
  });
})();
