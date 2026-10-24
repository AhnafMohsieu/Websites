<?php
// Router for PHP's built-in server so WordPress pretty permalinks and
// percent-encoded asset names (spaces in product images) both work.
$root = __DIR__ . '/app/public';
$path = urldecode(parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH));

// Reject traversal before touching the filesystem.
if (strpos($path, '..') !== false) {
    http_response_code(400);
    exit('Bad request');
}

$target = realpath($root . $path);

if ($path !== '/' && $target && is_file($target) && strpos($target, realpath($root)) === 0) {
    return false; // let the built-in server stream it with the right MIME type
}
if ($path !== '/' && $target && is_dir($target) && is_file($target . '/index.php')) {
    require $target . '/index.php';
    return true;
}
require $root . '/index.php';
