name := "parquet-lens-fixtures"
version := "0.1.0"
scalaVersion := "2.12.15"

val sparkVersion = "3.3.2"

libraryDependencies ++= Seq(
  "org.apache.spark" %% "spark-core" % sparkVersion,
  "org.apache.spark" %% "spark-sql"  % sparkVersion
)

fork := true
javaOptions ++= Seq(
  "-Dspark.master=local[*]",
  "-Xmx4g",
  "--add-opens=java.base/sun.nio.ch=ALL-UNNAMED",
  "--add-opens=java.base/java.nio=ALL-UNNAMED",
  "--add-opens=java.base/java.lang=ALL-UNNAMED",
  "--add-opens=java.base/java.util=ALL-UNNAMED",
  "--add-opens=java.base/java.lang.invoke=ALL-UNNAMED",
  "--add-opens=java.base/java.util.concurrent=ALL-UNNAMED"
)
