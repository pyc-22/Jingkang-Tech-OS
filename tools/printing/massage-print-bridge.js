const http = require('http');
const { spawn } = require('child_process');

const port = Number(process.env.MASSAGE_PRINT_BRIDGE_PORT || 9178);
const json = (response, status, body) => {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' });
  response.end(JSON.stringify(body));
};

function powerShell(script, payload) {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script, payload], { windowsHide: true });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(stdout.trim()) : reject(new Error(stderr.trim() || `PowerShell exited with ${code}`)));
  });
}

const listPrintersScript = "$items=Get-CimInstance Win32_Printer | Select-Object Name,Default,WorkOffline; $items | ConvertTo-Json -Compress";
const printScript = [
  'param($encoded)',
  'Add-Type -AssemblyName System.Drawing',
  '$job=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($encoded)) | ConvertFrom-Json',
  '$document=New-Object System.Drawing.Printing.PrintDocument',
  'if($job.printerName){$document.PrinterSettings.PrinterName=$job.printerName}',
  'if(-not $document.PrinterSettings.IsValid){throw "Configured printer is unavailable"}',
  '$width=[Math]::Round(([double]$job.paperWidthMm/25.4)*100)',
  '$document.DefaultPageSettings.PaperSize=New-Object System.Drawing.Printing.PaperSize("Receipt",$width,32767)',
  '$document.DefaultPageSettings.Margins=New-Object System.Drawing.Printing.Margins(6,6,6,6)',
  '$document.add_PrintPage({param($sender,$event) $font=New-Object System.Drawing.Font("Microsoft YaHei",[float]$job.fontSizePx);$brush=[System.Drawing.Brushes]::Black;$y=$event.MarginBounds.Top;foreach($line in ([string]$job.text -split "`n")){$event.Graphics.DrawString($line,$font,$brush,$event.MarginBounds.Left,$y);$y+=$font.GetHeight($event.Graphics)+1};$font.Dispose();$event.HasMorePages=$false})',
  '1..([int]$job.copies) | ForEach-Object {$document.Print()}',
  '$document.Dispose()'
].join(';');

http.createServer(async (request, response) => {
  if (request.method === 'OPTIONS') return json(response, 204, {});
  if (request.method === 'GET' && request.url === '/health') return json(response, 200, { status:'ready', port });
  if (request.method === 'GET' && request.url === '/printers') {
    try { const output = await powerShell(listPrintersScript, ''); return json(response, 200, { printers: output ? JSON.parse(output) : [] }); }
    catch (error) { return json(response, 500, { message:error.message }); }
  }
  if (request.method === 'POST' && request.url === '/print') {
    let body = '';
    request.on('data', chunk => { body += chunk; if (body.length > 256 * 1024) request.destroy(); });
    request.on('end', async () => {
      try {
        const job = JSON.parse(body);
        if (typeof job.text !== 'string' || !job.text.trim()) throw new Error('Receipt text is required');
        const payload = Buffer.from(JSON.stringify({ text:job.text, printerName:job.printerName || '', paperWidthMm:Number(job.paperWidthMm) || 80, fontSizePx:Number(job.fontSizePx) || 12, copies:Math.min(Math.max(Number(job.copies) || 1, 1), 3) }), 'utf8').toString('base64');
        await powerShell(printScript, payload);
        return json(response, 202, { status:'queued' });
      } catch (error) { return json(response, 500, { message:error.message }); }
    });
    return;
  }
  json(response, 404, { message:'Not found' });
}).listen(port, '127.0.0.1', () => console.log(`Massage print bridge: http://127.0.0.1:${port}`));
