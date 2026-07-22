#!/usr/bin/env bash
# 一次性：產生一把「固定的」自簽 codesigning 憑證，用來讓 macOS 版 Sage 的
# TCC 授權（輔助使用 / 資料夾存取）能跨啟動、跨改版保留。
#
# 為什麼需要它：未簽章 / ad-hoc 簽章的 App 沒有穩定的簽章身分，macOS 的 tccd
# 每次啟動都無法把它對回先前的授權，於是一直重跳權限。改用同一把憑證簽每個
# release 後，App 的 designated requirement 固定下來，授權只要給一次。
#
# 這把憑證是「機密」——請「只跑一次」，把產出的三個值存進 GitHub Secrets，
# 之後每次 release CI 都用同一把。重新產一把＝身分改變＝使用者又要重新授權。
#
# 用法：
#   bash scripts/gen-selfsigned-cert.sh
# 它會把 .p12 base64、密碼、identity 名稱印出來，照著設 GitHub Secrets 即可。
set -euo pipefail

CN="Sage Self-Signed"              # ← 簽章 identity 名稱（APPLE_SIGNING_IDENTITY）
OUT_DIR="$(mktemp -d)"
KEY="$OUT_DIR/key.pem"
CERT="$OUT_DIR/cert.pem"
P12="$OUT_DIR/sage-codesign.p12"

# 隨機一個 .p12 匯出密碼（也要存成 secret）
P12_PASS="$(openssl rand -base64 24 | tr -d '/+=' | head -c 32)"

echo "▸ 產生自簽 codesigning 憑證（CN=$CN，10 年效期）…"
openssl req -x509 -newkey rsa:2048 -sha256 -days 3650 -nodes \
  -keyout "$KEY" -out "$CERT" \
  -subj "/CN=$CN" \
  -addext "keyUsage=critical,digitalSignature" \
  -addext "extendedKeyUsage=critical,codeSigning" >/dev/null 2>&1

echo "▸ 打包成 .p12 …"
# -legacy：讓匯出格式相容於 GitHub macOS runner 的 `security import`
openssl pkcs12 -export -legacy \
  -inkey "$KEY" -in "$CERT" -out "$P12" \
  -name "$CN" -passout "pass:$P12_PASS" >/dev/null 2>&1

P12_B64="$(base64 -i "$P12")"

cat <<EOF

================================================================================
✅ 完成。到 GitHub → Settings → Secrets and variables → Actions 新增這三個 secret：

  APPLE_CERTIFICATE
  ---------------------------------------------------------------------
$P12_B64
  ---------------------------------------------------------------------

  APPLE_CERTIFICATE_PASSWORD
  ---------------------------------------------------------------------
$P12_PASS
  ---------------------------------------------------------------------

  APPLE_SIGNING_IDENTITY
  ---------------------------------------------------------------------
$CN
  ---------------------------------------------------------------------

（另外建議設一個 KEYCHAIN_PASSWORD＝任意隨機字串，供 CI 建立臨時 keychain 用）

⚠️  暫存檔在：$OUT_DIR
    設定完 secrets 後請刪除：rm -rf "$OUT_DIR"
    這些檔案「不要」commit 進 repo。
================================================================================
EOF
