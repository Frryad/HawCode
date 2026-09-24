<?php
header('X-Powered-By: HawHost PHP Bridge');
?>
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>HawHost PHP Diagnostic Page</title>
  <style>
    body { font-family: sans-serif; background: #0b0f17; color: #f1f5f9; padding: 2rem; }
    .card { background: #161e2e; border: 1px solid #334155; border-radius: 12px; padding: 2rem; max-width: 700px; margin: 0 auto; }
    h1 { color: #38bdf8; font-size: 1.5rem; }
    table { width: 100%; border-collapse: collapse; margin-top: 1rem; }
    td, th { padding: 8px 12px; border-bottom: 1px solid #334155; font-size: 13px; text-align: left; }
    th { color: #94a3b8; }
    .val { font-family: monospace; color: #34d399; }
  </style>
</head>
<body>
  <div class="card">
    <h1>HawHost PHP Engine Active</h1>
    <p>PHP is executing successfully on your Windows self-hosted server.</p>
    <table>
      <tr><th>Variable</th><th>Value</th></tr>
      <tr><td>PHP Version</td><td class="val"><?php echo phpversion(); ?></td></tr>
      <tr><td>Server Software</td><td class="val"><?php echo $_SERVER['SERVER_SOFTWARE'] ?? 'HawHost'; ?></td></tr>
      <tr><td>Request Method</td><td class="val"><?php echo $_SERVER['REQUEST_METHOD'] ?? 'GET'; ?></td></tr>
      <tr><td>Host Domain</td><td class="val"><?php echo $_SERVER['SERVER_NAME'] ?? 'localhost'; ?></td></tr>
      <tr><td>Current Time</td><td class="val"><?php echo date('Y-m-d H:i:s'); ?></td></tr>
    </table>
  </div>
</body>
</html>
