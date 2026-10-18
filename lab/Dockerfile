FROM python:3.12-alpine
RUN apk add --no-cache iproute2 iputils curl tcpdump nano && pip install --no-cache-dir scapy==2.6.1
COPY poison.py poison_student.py service.py request.py /opt/lab/
RUN mkdir -p /work && cp /opt/lab/poison_student.py /work/poison_student.py && cp /opt/lab/request.py /work/request.py
WORKDIR /work
