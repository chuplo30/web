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

  function show(ok, html) {
    box.hidden = false;
    box.className = "result " + (ok ? "ok" : "err");
    box.innerHTML = html;
  }

  btn.addEventListener("click", async function () {
    btn.disabled = true;
    btn.textContent = "Uploading…";
    box.hidden = true;
    try {
      let res;
      if (fileInput.files && fileInput.files[0]) {
        const fd = new FormData();
        fd.set("ttl", ttl);
        fd.set("file", fileInput.files[0]);
        res = await fetch("/api/upload", { method: "POST", body: fd });
      } else {
        res = await fetch("/api/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            content: content.value || "",
            filename: "paste.txt",
            ttl: ttl,
          }),
        });
      }
      const data = await res.json().catch(function () { return {}; });
      if (!res.ok) {
        show(false, data.error || ("http_" + res.status));
      } else {
        var u = data.url || ("/api/raw?id=" + data.id);
        show(true, "Uploaded<br><a href=\"" + u + "\" target=\"_blank\" rel=\"noreferrer\">" + u + "</a>");
      }
    } catch (e) {
      show(false, "network_error");
    } finally {
      btn.disabled = false;
      btn.textContent = "Upload";
    }
  });
})();
