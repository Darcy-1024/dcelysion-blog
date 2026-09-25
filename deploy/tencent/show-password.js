(() => {
  const labels = {
    "zh-CN": "显示密码",
    "zh-TW": "顯示密碼",
    en: "Show password",
    ja: "パスワードを表示",
    ko: "비밀번호 표시",
    ru: "Показать пароль",
  };

  function getLabel() {
    const language = localStorage.getItem("i18nextLng") || navigator.language;
    const normalized = language.toLowerCase();
    if (normalized.startsWith("zh")) {
      return normalized.includes("tw") || normalized.includes("hk")
        ? labels["zh-TW"]
        : labels["zh-CN"];
    }
    return labels[normalized.split("-")[0]] || labels.en;
  }

  const optionalLabels = {
    "zh-CN": "选填",
    "zh-TW": "選填",
    en: "optional",
    id: "opsional",
    de: "optional",
    es: "opcional",
    fr: "facultatif",
    it: "facoltativo",
    ja: "任意",
    ko: "선택 사항",
    pt: "opcional",
    ru: "необязательно",
    vi: "không bắt buộc",
  };
  const optionalEndings = Object.entries(optionalLabels).map(([language, value]) =>
    language.startsWith("zh") ? `（${value}）` : ` (${value})`,
  );

  function getOptionalEnding() {
    const language = (localStorage.getItem("i18nextLng") || navigator.language).toLowerCase();
    if (language.startsWith("zh")) {
      return language.includes("tw") || language.includes("hk") ? "（選填）" : "（选填）";
    }
    return ` (${optionalLabels[language.split("-")[0]] || optionalLabels.en})`;
  }

  function annotateWebsite(form) {
    if (!location.pathname.endsWith("/ui/register")) return;
    const website = form?.querySelector('input#link[name="link"]');
    if (!website) return;
    let base = website.getAttribute("placeholder") || "";
    if (!base) return;
    const existingEnding = optionalEndings.find((ending) => base.endsWith(ending));
    if (existingEnding) base = base.slice(0, -existingEnding.length);
    const next = base + getOptionalEnding();
    if (website.getAttribute("placeholder") !== next) {
      website.setAttribute("placeholder", next);
    }
    const label = form.querySelector('label[for="link"]');
    if (label && label.textContent !== next) label.textContent = next;
  }
  function mount() {
    const form = document.querySelector('.typecho-login form[name="login"]');
    annotateWebsite(form);
    const password = form?.querySelector('input#password[name="password"]');
    if (!password) return;

    const existing = form.querySelector("#show-password-option");
    if (existing) {
      const text = existing.querySelector("span");
      const label = getLabel();
      if (text.textContent !== label) text.textContent = label;
      const expectedType = existing.querySelector("input").checked ? "text" : "password";
      if (password.type !== expectedType) password.type = expectedType;
      return;
    }

    const row = document.createElement("p");
    row.id = "show-password-option";
    row.style.textAlign = "left";
    const label = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.id = "show-password";
    checkbox.className = "checkbox";
    const text = document.createElement("span");
    text.textContent = getLabel();
    label.append(checkbox, " ", text);
    row.append(label);
    password.closest("p").after(row);
    checkbox.addEventListener("change", () => {
      const currentPassword = form.querySelector('input#password[name="password"]');
      if (currentPassword) currentPassword.type = checkbox.checked ? "text" : "password";
    });
  }

  const observer = new MutationObserver(mount);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["type", "placeholder"],
  });
  mount();
})();
