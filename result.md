wail@DESKTOP-9C7O4JH:~/bootdev/final_0$ RATE=300 BATCH_SIZE=50  k6 run load-60s.js   # Experiment A

         /\      Grafana   /‾‾/  
    /\  /  \     |\  __   /  /   
   /  \/    \    | |/ /  /   ‾‾\ 
  /          \   |   (  |  (‾)  |
 / __________ \  |_|\_\  \_____/ 


     execution: local
        script: load-60s.js
        output: -

     scenarios: (100.00%) 2 scenarios, 1210 max VUs, 1m35s max duration (incl. graceful stop):
              * ingest: 300.00 iterations/s for 1m0s (maxVUs: 600-1200, exec: ingest, gracefulStop: 30s)
              * aggregate: 1.00 iterations/s for 1m0s (maxVUs: 5-10, exec: aggregate, startTime: 5s, gracefulStop: 30s)



  █ THRESHOLDS 

    http_req_duration{name:aggregate}
    ✓ 'p(95)<1000' p(95)=851.34ms

    http_req_duration{name:ingest}
    ✓ 'p(95)<2000' p(95)=370.29ms

    http_req_failed{name:ingest}
    ✓ 'rate<0.01' rate=0.00%


  █ TOTAL RESULTS 

    checks_total.......: 18062   262.607999/s
    checks_succeeded...: 100.00% 18062 out of 18062
    checks_failed......: 0.00%   0 out of 18062

    ✓ status is 200
    ✓ aggregate status is 200

    CUSTOM
    logs_accepted..................: 900050 13086.055249/s
    logs_rejected..................: 0      0/s

    HTTP
    http_req_duration..............: avg=113.19ms min=1.34ms   med=58.45ms  max=1.93s    p(90)=296.29ms p(95)=370.72ms
      { expected_response:true }...: avg=113.19ms min=1.34ms   med=58.45ms  max=1.93s    p(90)=296.29ms p(95)=370.72ms
      { name:aggregate }...........: avg=296.89ms min=119.92ms med=213.88ms max=1.65s    p(90)=608.65ms p(95)=851.34ms
      { name:ingest }..............: avg=112.57ms min=1.34ms   med=57.83ms  max=1.93s    p(90)=295.89ms p(95)=370.29ms
    http_req_failed................: 0.00%  0 out of 18062
      { name:ingest }..............: 0.00%  0 out of 18001
    http_reqs......................: 18062  262.607999/s

    EXECUTION
    iteration_duration.............: avg=108.82ms min=1.76ms   med=58.58ms  max=973.54ms p(90)=291.47ms p(95)=360.46ms
    iterations.....................: 18062  262.607999/s
    vus............................: 0      min=0          max=166
    vus_max........................: 605    min=605        max=605

    NETWORK
    data_received..................: 4.8 MB 70 kB/s
    data_sent......................: 168 MB 2.4 MB/s




running (1m08.8s), 0000/0605 VUs, 18062 complete and 0 interrupted iterations
ingest    ✓ [======================================] 0000/0600 VUs  1m0s  300.00 iters/s
aggregate ✓ [======================================] 00/05 VUs      1m0s  1.00 iters/s


===============================================================================================================================================================================

wail@DESKTOP-9C7O4JH:~/bootdev/final_0$ RATE=400 BATCH_SIZE=37 k6 run load-60s.js

         /\      Grafana   /‾‾/  
    /\  /  \     |\  __   /  /   
   /  \/    \    | |/ /  /   ‾‾\ 
  /          \   |   (  |  (‾)  |
 / __________ \  |_|\_\  \_____/ 


     execution: local
        script: load-60s.js
        output: -

     scenarios: (100.00%) 2 scenarios, 1210 max VUs, 1m35s max duration (incl. graceful stop):
              * ingest: 400.00 iterations/s for 1m0s (maxVUs: 600-1200, exec: ingest, gracefulStop: 30s)
              * aggregate: 1.00 iterations/s for 1m0s (maxVUs: 5-10, exec: aggregate, startTime: 5s, gracefulStop: 30s)



  █ THRESHOLDS 

    http_req_duration{name:aggregate}
    ✓ 'p(95)<1000' p(95)=725.51ms

    http_req_duration{name:ingest}
    ✓ 'p(95)<2000' p(95)=1.02s

    http_req_failed{name:ingest}
    ✓ 'rate<0.01' rate=0.00%


  █ TOTAL RESULTS 

    checks_total.......: 24032   347.860453/s
    checks_succeeded...: 100.00% 24032 out of 24032
    checks_failed......: 0.00%   0 out of 24032

    ✓ status is 200
    ✓ aggregate status is 200

    CUSTOM
    logs_accepted..................: 886927 12838.166954/s
    logs_rejected..................: 0      0/s

    HTTP
    http_req_duration..............: avg=179.59ms min=1.18ms  med=19.47ms max=2.2s     p(90)=641.76ms p(95)=1.02s   
      { expected_response:true }...: avg=179.59ms min=1.18ms  med=19.47ms max=2.2s     p(90)=641.76ms p(95)=1.02s   
      { name:aggregate }...........: avg=174.49ms min=12.97ms med=95.16ms max=931.83ms p(90)=540ms    p(95)=725.51ms
      { name:ingest }..............: avg=179.6ms  min=1.18ms  med=18.92ms max=2.2s     p(90)=642.66ms p(95)=1.02s   
    http_req_failed................: 0.00%  0 out of 24032
      { name:ingest }..............: 0.00%  0 out of 23971
    http_reqs......................: 24032  347.860453/s

    EXECUTION
    dropped_iterations.............: 30     0.434247/s
    iteration_duration.............: avg=174.72ms min=1.5ms   med=19.82ms max=2.2s     p(90)=599.98ms p(95)=989.65ms
    iterations.....................: 24032  347.860453/s
    vus............................: 0      min=0          max=607
    vus_max........................: 635    min=605        max=635

    NETWORK
    data_received..................: 6.3 MB 92 kB/s
    data_sent......................: 167 MB 2.4 MB/s




running (1m09.1s), 0000/0635 VUs, 24032 complete and 0 interrupted iterations
ingest    ✓ [======================================] 0000/0630 VUs  1m0s  400.00 iters/s
aggregate ✓ [======================================] 00/05 VUs      1m0s  1.00 iters/s
wail@DESKTOP-9C7O4JH:~/bootdev/final_0$ 