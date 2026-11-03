# DeviceBridge v0.4 web client

Personal-device encrypted C task client. This repository contains public frontend assets only; pairing data, access tokens, encryption keys and the desktop data folder must never be committed.

C code runs on your own Windows computer. Desktop v0.4 adds account-protected settings, resource limits, shutdown cleanup and encrypted response retries. These are not a filesystem or network sandbox: run only trusted code. Camera frames are processed locally. QR component licenses are in QR-LICENSES.txt.

Desktop startup and remote execution require the computer owner. The website does not turn on a sleeping computer or start a stopped service.
