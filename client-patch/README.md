# AstroQuiz client patch — 8.1 hardening/UI

Este diretório é um patch de cliente para aplicar sobre o projeto Android/8.1 real.

## Segurança

- Artenos.kt: assinatura SHA-256 do certificado, debugger, root, instrumentation e emulator checks.
- Asteios.kt: catálogo e economia com valores fixos; o cliente não deve receber preço/quantidade arbitrários.
- O APK deve ser Release com R8/minify/shrink e o SHA-256 da keystore deve ser injetado no BuildConfig.

## Start.io

StartIoAdManager.kt:

- desativa Return Ads;
- cria uma nova instância após cada anúncio usado;
- espera onReceiveAd antes de exibir;
- nunca exibe duas unidades simultaneamente;
- verifica Activity válida/foco;
- protege callbacks contra chamada dupla;
- captura falhas de show/load para que um anúncio não encerre a partida;
- não apaga o cache/dados do aplicativo. "Limpar cache" aqui significa descartar a instância de anúncio e recarregar uma nova.

## UI

activity_quiz_enhanced.xml mantém os IDs principais do quiz, mas melhora hierarquia, espaçamento, área da imagem, cartões e respostas.

Atenção: o repositório GitHub atual do AstroQuiz é o authority server. O código completo do APK 8.1 não está disponível nele. Estes arquivos são uma camada de patch e não alegam ser uma compilação final 8.1.
