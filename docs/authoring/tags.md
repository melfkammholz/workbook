# tags.yml

There are two kinds of tags. A **topic** says what an exercise is about, a **signal**
says what it will be like to do it. They look different in the app and are
separate groups in the filters. Tags are topics unless they say otherwise.

```yaml
diff: Differenzieren                                    # a topic, with a plain label
recursion: { label: Rekursion, color: teal }            # a topic
deep-dive: { label: Deep Dive, type: signal }           # a signal
```

The review page shows students how confident they are per topic. Some topics are not what the course teaches, for example when differentiation is only the example an exercise uses. Those stay useful for filtering, but `review: false` keeps them out of that overview:

```yaml
diff: { label: Differenzieren, review: false }
```

`long: true` on an exercise is a built-in signal: "takes a while".
